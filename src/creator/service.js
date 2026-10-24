import { ObjectId } from "mongodb";
import {
    creditsToCents,
    validateCampaignCreateInput,
    validateCampaignUpdateInput,
    validateWithdrawalRequest,
} from "./domain.js";

export const PAYMENT_SYSTEMS = Object.freeze(["Stripe", "Bkash", "Rocket", "Nagad", "Other"]);

export class CreatorServiceError extends Error {
    constructor(status, message, details) {
        super(message);
        this.name = "CreatorServiceError";
        this.status = status;
        this.details = details;
    }
}

function toObjectId(value) {
    if (!ObjectId.isValid(value)) throw new CreatorServiceError(400, "Invalid resource ID.");
    return new ObjectId(value);
}

function creatorId(actor) {
    if (!actor || actor.role !== "creator") {
        throw new CreatorServiceError(403, "Creator access is required.");
    }
    return toObjectId(actor.id);
}

function assertValid(errors) {
    if (Object.keys(errors).length > 0) {
        throw new CreatorServiceError(400, "Please correct the highlighted fields.", errors);
    }
}

async function transaction(client, callback) {
    const session = client.startSession();
    try {
        let result;
        await session.withTransaction(async () => {
            result = await callback(session);
        });
        return result;
    } finally {
        await session.endSession();
    }
}

function isPendingContribution(contribution) {
    return contribution?.status === "pending" && contribution.amountCredits > 0;
}

export async function createCampaign(database, actor, input, now = new Date()) {
    const ownerId = creatorId(actor);
    assertValid(validateCampaignCreateInput(input, now.getTime()));

    const campaign = {
        creatorId: ownerId,
        creatorEmail: actor.email,
        creatorName: actor.name,
        title: input.title.trim(),
        story: input.story.trim(),
        category: input.category.trim(),
        fundingGoal: input.fundingGoal,
        minimumContribution: input.minimumContribution,
        deadline: new Date(input.deadline),
        rewardInfo: input.rewardInfo.trim(),
        imageUrl: input.imageUrl.trim(),
        status: "pending",
        lifecycle: "active",
        raisedCredits: 0,
        pendingCredits: 0,
        createdAt: now,
        updatedAt: now,
    };

    const result = await database.collection("campaign").insertOne(campaign);
    return { ...campaign, _id: result.insertedId };
}

export async function listCreatorCampaigns(database, actor) {
    const ownerId = creatorId(actor);
    return database.collection("campaign")
        .find({ creatorId: ownerId })
        .sort({ deadline: -1, createdAt: -1 })
        .toArray();
}

export async function listPublicCampaigns(database, now = new Date()) {
    return database.collection("campaign")
        .find({ status: "approved", lifecycle: "active", deadline: { $gt: now } })
        .project({
            title: 1,
            story: 1,
            category: 1,
            fundingGoal: 1,
            minimumContribution: 1,
            deadline: 1,
            rewardInfo: 1,
            imageUrl: 1,
            creatorName: 1,
            status: 1,
            lifecycle: 1,
            raisedCredits: 1,
            createdAt: 1,
        })
        .sort({ createdAt: -1 })
        .toArray();
}

export async function getPublicCampaign(database, campaignId, now = new Date()) {
    const id = toObjectId(campaignId);
    const campaign = await database.collection("campaign").findOne(
        { _id: id, status: "approved", lifecycle: "active", deadline: { $gt: now } },
        {
            projection: {
                title: 1, story: 1, category: 1, fundingGoal: 1, minimumContribution: 1,
                deadline: 1, rewardInfo: 1, imageUrl: 1, creatorName: 1,
                status: 1, lifecycle: 1, raisedCredits: 1, createdAt: 1,
            },
        },
    );
    if (!campaign) throw new CreatorServiceError(404, "Campaign not found.");
    return campaign;
}

export async function reviewCampaignModeration(database, actor, campaignId, decision, now = new Date()) {
    if (actor?.role !== "admin") throw new CreatorServiceError(403, "Admin access is required.");
    if (!["approve", "reject"].includes(decision)) throw new CreatorServiceError(400, "Invalid campaign decision.");
    const id = toObjectId(campaignId);
    const status = decision === "approve" ? "approved" : "rejected";
    const result = await database.collection("campaign").updateOne(
        { _id: id, status: "pending", lifecycle: "active" },
        { $set: { status, reviewedAt: now, updatedAt: now } },
    );
    if (result.modifiedCount !== 1) throw new CreatorServiceError(409, "Campaign is not pending review.");
    return { status, reviewedAt: now };
}

export async function updateCampaign(database, actor, campaignId, patch, now = new Date()) {
    const ownerId = creatorId(actor);
    const id = toObjectId(campaignId);
    const campaigns = database.collection("campaign");
    const existing = await campaigns.findOne({ _id: id, creatorId: ownerId });
    if (!existing) throw new CreatorServiceError(404, "Campaign not found.");
    if (existing.lifecycle !== "active" || existing.status === "rejected") {
        throw new CreatorServiceError(409, "This campaign can no longer be edited.");
    }

    assertValid(validateCampaignUpdateInput(existing, patch, now.getTime()));
    const update = Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, value.trim()]));
    await campaigns.updateOne(
        { _id: id, creatorId: ownerId, lifecycle: "active", status: { $ne: "rejected" } },
        { $set: { ...update, updatedAt: now } },
    );
    return { ...existing, ...update, updatedAt: now };
}

export async function archiveOrDeleteCampaign(database, client, actor, campaignId, now = new Date()) {
    const ownerId = creatorId(actor);
    const id = toObjectId(campaignId);
    return transaction(client, async (session) => {
        const campaigns = database.collection("campaign");
        const contributions = database.collection("contribution");
        const campaign = await campaigns.findOne({ _id: id, creatorId: ownerId }, { session });
        if (!campaign) throw new CreatorServiceError(404, "Campaign not found.");

        const contributionCount = await contributions.countDocuments({ campaignId: id }, { session });
        if (contributionCount === 0) {
            await campaigns.deleteOne({ _id: id, creatorId: ownerId }, { session });
            return { deleted: true };
        }

        // Refund all approved supporters before archiving.
        const approvedContributions = await contributions
            .find({ campaignId: id, status: "approved" }, { session })
            .toArray();

        if (approvedContributions.length > 0) {
            // Aggregate credits per supporter (a supporter may have multiple approved contributions).
            const refundBySupporterId = new Map();
            for (const contribution of approvedContributions) {
                const key = contribution.supporterId.toString();
                refundBySupporterId.set(
                    key,
                    {
                        supporterId: contribution.supporterId,
                        amount: (refundBySupporterId.get(key)?.amount ?? 0) + contribution.amountCredits,
                    },
                );
            }

            // Bulk-increment each supporter's credits in one round-trip.
            await database.collection("user").bulkWrite(
                [...refundBySupporterId.values()].map(({ supporterId, amount }) => ({
                    updateOne: {
                        filter: { _id: supporterId },
                        update: { $inc: { credits: amount } },
                    },
                })),
                { session },
            );

            // Deduct the total refunded amount from the creator's earned/payout balances.
            const totalRefunded = approvedContributions.reduce(
                (sum, contribution) => sum + contribution.amountCredits,
                0,
            );
            await database.collection("user").updateOne(
                { _id: ownerId, role: "creator" },
                { $inc: { totalEarnedCredits: -totalRefunded, payoutBalanceCredits: -totalRefunded } },
                { session },
            );

            // Mark all approved contributions as refunded.
            await contributions.updateMany(
                { campaignId: id, status: "approved" },
                { $set: { status: "refunded", updatedAt: now } },
                { session },
            );
        }

        await campaigns.updateOne(
            { _id: id, creatorId: ownerId, lifecycle: { $ne: "archived" } },
            { $set: { lifecycle: "archived", updatedAt: now } },
            { session },
        );
        return { deleted: false, lifecycle: "archived" };
    });
}

export async function getCreatorSummary(database, actor, now = new Date()) {
    const ownerId = creatorId(actor);
    const campaigns = database.collection("campaign");
    const [totalCampaigns, activeCampaigns, totals, user] = await Promise.all([
        campaigns.countDocuments({ creatorId: ownerId }),
        campaigns.countDocuments({
            creatorId: ownerId,
            status: "approved",
            lifecycle: "active",
            deadline: { $gt: now },
        }),
        campaigns.aggregate([
            { $match: { creatorId: ownerId } },
            { $group: { _id: null, totalRaisedCredits: { $sum: "$raisedCredits" } } },
        ]).toArray(),
        database.collection("user").findOne({ _id: ownerId }, {
            projection: { totalEarnedCredits: 1, payoutBalanceCredits: 1 },
        }),
    ]);

    return {
        totalCampaigns,
        activeCampaigns,
        totalRaisedCredits: totals[0]?.totalRaisedCredits || 0,
        totalEarnedCredits: user?.totalEarnedCredits || 0,
        availablePayoutCredits: user?.payoutBalanceCredits || 0,
    };
}

export async function listPendingContributions(database, actor) {
    const ownerId = creatorId(actor);
    const campaigns = await database.collection("campaign")
        .find({ creatorId: ownerId }, { projection: { _id: 1 } })
        .toArray();
    if (campaigns.length === 0) return [];

    return database.collection("contribution")
        .find({ campaignId: { $in: campaigns.map((campaign) => campaign._id) }, status: "pending" })
        .sort({ createdAt: 1 })
        .toArray();
}

export async function createContribution(database, client, actor, input, now = new Date()) {
    if (!actor || actor.role !== "supporter") throw new CreatorServiceError(403, "Supporter access is required.");
    const supporterId = toObjectId(actor.id);
    const campaignId = toObjectId(input.campaignId);
    const amountCredits = input.amountCredits;
    if (!Number.isSafeInteger(amountCredits) || amountCredits <= 0) {
        throw new CreatorServiceError(400, "Contribution amount must be a positive whole number of credits.");
    }
    const message = typeof input.message === "string" ? input.message.trim() : "";
    if (message.length > 2000) throw new CreatorServiceError(400, "Contribution message is too long.");

    return transaction(client, async (session) => {
        const campaignCollection = database.collection("campaign");
        const campaign = await campaignCollection.findOne({
            _id: campaignId,
            status: "approved",
            lifecycle: "active",
            deadline: { $gt: now },
            minimumContribution: { $lte: amountCredits },
        }, { session });
        if (!campaign) throw new CreatorServiceError(404, "This campaign is unavailable for contributions.");
        if (campaign.raisedCredits + campaign.pendingCredits + amountCredits > campaign.fundingGoal) {
            throw new CreatorServiceError(409, "This contribution would exceed the campaign goal.");
        }

        const debit = await database.collection("user").updateOne(
            { _id: supporterId, role: "supporter", credits: { $gte: amountCredits } },
            { $inc: { credits: -amountCredits } },
            { session },
        );
        if (debit.modifiedCount !== 1) throw new CreatorServiceError(409, "Insufficient available credits.");

        const reserve = await campaignCollection.updateOne(
            {
                _id: campaignId,
                status: "approved",
                lifecycle: "active",
                deadline: { $gt: now },
                pendingCredits: campaign.pendingCredits,
                raisedCredits: campaign.raisedCredits,
                $expr: {
                    $lte: [
                        { $add: ["$raisedCredits", "$pendingCredits", amountCredits] },
                        "$fundingGoal",
                    ],
                },
            },
            { $inc: { pendingCredits: amountCredits }, $set: { updatedAt: now } },
            { session },
        );
        if (reserve.modifiedCount !== 1) throw new CreatorServiceError(409, "Campaign is no longer accepting this contribution.");

        const contribution = {
            campaignId,
            campaignTitle: campaign.title,
            creatorId: campaign.creatorId,
            supporterId,
            supporterName: actor.name,
            amountCredits,
            message,
            status: "pending",
            createdAt: now,
            updatedAt: now,
        };
        const inserted = await database.collection("contribution").insertOne(contribution, { session });
        return { ...contribution, _id: inserted.insertedId };
    });
}

export async function reviewContribution(database, client, actor, contributionId, decision, now = new Date()) {
    const ownerId = creatorId(actor);
    const id = toObjectId(contributionId);
    if (!["approve", "reject"].includes(decision)) throw new CreatorServiceError(400, "Invalid contribution decision.");

    return transaction(client, async (session) => {
        const contributions = database.collection("contribution");
        const campaigns = database.collection("campaign");
        const contribution = await contributions.findOne({ _id: id, creatorId: ownerId, status: "pending" }, { session });
        if (!isPendingContribution(contribution)) throw new CreatorServiceError(409, "Contribution is no longer pending.");

        const campaign = await campaigns.findOne({ _id: contribution.campaignId, creatorId: ownerId }, { session });
        if (!campaign) throw new CreatorServiceError(404, "Campaign not found.");

        const nextStatus = decision === "approve" ? "approved" : "rejected";
        const changed = await contributions.updateOne(
            { _id: id, creatorId: ownerId, status: "pending" },
            { $set: { status: nextStatus, reviewedAt: now, updatedAt: now } },
            { session },
        );
        if (changed.modifiedCount !== 1) throw new CreatorServiceError(409, "Contribution was already reviewed.");

        if (decision === "approve") {
            const raisedCredits = campaign.raisedCredits + contribution.amountCredits;
            await campaigns.updateOne(
                { _id: campaign._id, creatorId: ownerId },
                {
                    $inc: { raisedCredits: contribution.amountCredits, pendingCredits: -contribution.amountCredits },
                    $set: {
                        lifecycle: raisedCredits >= campaign.fundingGoal ? "funded" : campaign.lifecycle,
                        updatedAt: now,
                    },
                },
                { session },
            );
            await database.collection("user").updateOne(
                { _id: ownerId, role: "creator" },
                { $inc: { totalEarnedCredits: contribution.amountCredits, payoutBalanceCredits: contribution.amountCredits } },
                { session },
            );
        } else {
            await campaigns.updateOne(
                { _id: campaign._id, creatorId: ownerId },
                { $inc: { pendingCredits: -contribution.amountCredits }, $set: { updatedAt: now } },
                { session },
            );
            await database.collection("user").updateOne(
                { _id: contribution.supporterId, role: "supporter" },
                { $inc: { credits: contribution.amountCredits } },
                { session },
            );
        }

        return { ...contribution, status: nextStatus, reviewedAt: now };
    });
}

export async function createWithdrawalRequest(database, client, actor, input, now = new Date()) {
    const ownerId = creatorId(actor);
    const requestedCredits = input.creditsToWithdraw;
    const paymentSystem = input.paymentSystem;
    const accountNumber = typeof input.accountNumber === "string" ? input.accountNumber.trim() : "";
    if (!PAYMENT_SYSTEMS.includes(paymentSystem)) throw new CreatorServiceError(400, "Choose a supported payment system.");
    if (!/^[\w+() .-]{6,80}$/.test(accountNumber)) throw new CreatorServiceError(400, "Enter a valid payout account number.");

    return transaction(client, async (session) => {
        const users = database.collection("user");
        const user = await users.findOne({ _id: ownerId, role: "creator" }, { session });
        if (!user) throw new CreatorServiceError(404, "Creator account not found.");

        const availableCredits = user.payoutBalanceCredits || 0;
        const earnedCredits = user.totalEarnedCredits || 0;
        assertValid(validateWithdrawalRequest({ earnedCredits, availableCredits, requestedCredits }));

        const reserved = await users.updateOne(
            { _id: ownerId, role: "creator", payoutBalanceCredits: { $gte: requestedCredits } },
            { $inc: { payoutBalanceCredits: -requestedCredits, pendingWithdrawalCredits: requestedCredits } },
            { session },
        );
        if (reserved.modifiedCount !== 1) throw new CreatorServiceError(409, "Payout balance changed. Refresh and try again.");

        const payout = {
            creatorId: ownerId,
            creatorEmail: user.email,
            creatorName: user.name,
            withdrawalCredits: requestedCredits,
            withdrawalAmountCents: creditsToCents(requestedCredits),
            paymentSystem,
            accountNumber,
            status: "pending",
            createdAt: now,
            updatedAt: now,
        };
        const inserted = await database.collection("withdrawal").insertOne(payout, { session });
        return { ...payout, _id: inserted.insertedId };
    });
}

export async function listCreatorWithdrawals(database, actor) {
    const ownerId = creatorId(actor);
    return database.collection("withdrawal")
        .find({ creatorId: ownerId })
        .project({ accountNumber: 0 })
        .sort({ createdAt: -1 })
        .toArray();
}