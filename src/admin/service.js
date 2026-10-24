import { ObjectId } from "mongodb";

export class AdminServiceError extends Error {
    constructor(status, message, details) {
        super(message);
        this.name = "AdminServiceError";
        this.status = status;
        this.details = details;
    }
}

const ALL_ROLES = Object.freeze(["admin", "creator", "supporter"]);

function requireAdmin(actor) {
    if (!actor || actor.role !== "admin") {
        throw new AdminServiceError(403, "Admin access is required.");
    }
}

function toObjectId(value) {
    if (!ObjectId.isValid(value)) throw new AdminServiceError(400, "Invalid resource ID.");
    return new ObjectId(value);
}

async function transaction(client, callback) {
    const session = client.startSession();
    try {
        let result;
        await session.withTransaction(async () => { result = await callback(session); });
        return result;
    } finally {
        await session.endSession();
    }
}

// ─────────────────────────────────────────────────────────────────
//  HOME STATS
// ─────────────────────────────────────────────────────────────────

/**
 * Returns platform-level summary counts for the admin home page.
 */
export async function getAdminSummary(database, actor) {
    requireAdmin(actor);

    const users     = database.collection("user");
    const campaigns = database.collection("campaign");
    const purchases = database.collection("credit_purchase");

    const [
        totalSupporters,
        totalCreators,
        creditAgg,
        totalPayments,
        pendingCampaigns,
        pendingWithdrawals,
    ] = await Promise.all([
        users.countDocuments({ role: "supporter" }),
        users.countDocuments({ role: "creator" }),
        users.aggregate([
            { $group: { _id: null, total: { $sum: "$credits" } } },
        ]).toArray(),
        purchases.countDocuments({ status: "completed" }),
        campaigns.countDocuments({ status: "pending" }),
        database.collection("withdrawal").countDocuments({ status: "pending" }),
    ]);

    return {
        totalSupporters,
        totalCreators,
        totalAvailableCredits: creditAgg[0]?.total || 0,
        totalPaymentsProcessed: totalPayments,
        pendingCampaigns,
        pendingWithdrawals,
    };
}

// ─────────────────────────────────────────────────────────────────
//  USERS
// ─────────────────────────────────────────────────────────────────

/**
 * Lists all users with safe fields only (no password hash / tokens).
 */
export async function listAllUsers(database, actor) {
    requireAdmin(actor);
    return database.collection("user")
        .find({})
        .project({ name: 1, email: 1, image: 1, role: 1, credits: 1, roleOnboarded: 1, createdAt: 1 })
        .sort({ createdAt: -1 })
        .toArray();
}

/**
 * Changes a user's role. Admin cannot demote themselves.
 */
export async function updateUserRole(database, actor, targetUserId, newRole, now = new Date()) {
    requireAdmin(actor);
    if (!ALL_ROLES.includes(newRole)) {
        throw new AdminServiceError(400, "Invalid role. Choose admin, creator, or supporter.");
    }
    if (actor.id === targetUserId) {
        throw new AdminServiceError(409, "You cannot change your own role.");
    }

    const id = toObjectId(targetUserId);
    const result = await database.collection("user").updateOne(
        { _id: id },
        { $set: { role: newRole, updatedAt: now } },
    );
    if (result.matchedCount !== 1) throw new AdminServiceError(404, "User not found.");
    return { userId: targetUserId, role: newRole };
}

/**
 * Permanently removes a user from the database.
 * Admin cannot delete themselves.
 */
export async function removeUser(database, actor, targetUserId) {
    requireAdmin(actor);
    if (actor.id === targetUserId) {
        throw new AdminServiceError(409, "You cannot remove your own account.");
    }
    const id = toObjectId(targetUserId);
    const result = await database.collection("user").deleteOne({ _id: id });
    if (result.deletedCount !== 1) throw new AdminServiceError(404, "User not found.");
    return { deleted: true, userId: targetUserId };
}

// ─────────────────────────────────────────────────────────────────
//  CAMPAIGN APPROVALS  (pending)
// ─────────────────────────────────────────────────────────────────

/**
 * Lists all campaigns with a "pending" status, newest first.
 */
export async function listPendingCampaigns(database, actor) {
    requireAdmin(actor);
    return database.collection("campaign")
        .find({ status: "pending" })
        .sort({ createdAt: -1 })
        .toArray();
}

// ─────────────────────────────────────────────────────────────────
//  MANAGE CAMPAIGNS  (all campaigns)
// ─────────────────────────────────────────────────────────────────

/**
 * Lists every campaign regardless of status, newest first.
 */
export async function listAllCampaigns(database, actor) {
    requireAdmin(actor);
    return database.collection("campaign")
        .find({})
        .sort({ createdAt: -1 })
        .toArray();
}

/**
 * Hard-deletes a campaign and refunds all approved supporters.
 * Uses a transaction so the refund and delete are atomic.
 */
export async function adminDeleteCampaign(database, client, actor, campaignId, now = new Date()) {
    requireAdmin(actor);
    const id = toObjectId(campaignId);

    return transaction(client, async (session) => {
        const campaigns     = database.collection("campaign");
        const contributions = database.collection("contribution");

        const campaign = await campaigns.findOne({ _id: id }, { session });
        if (!campaign) throw new AdminServiceError(404, "Campaign not found.");

        // Refund all approved supporters.
        const approvedContributions = await contributions
            .find({ campaignId: id, status: "approved" }, { session })
            .toArray();

        if (approvedContributions.length > 0) {
            const refundMap = new Map();
            for (const c of approvedContributions) {
                const key = c.supporterId.toString();
                refundMap.set(key, {
                    supporterId: c.supporterId,
                    amount: (refundMap.get(key)?.amount ?? 0) + c.amountCredits,
                });
            }
            await database.collection("user").bulkWrite(
                [...refundMap.values()].map(({ supporterId, amount }) => ({
                    updateOne: {
                        filter: { _id: supporterId },
                        update: { $inc: { credits: amount } },
                    },
                })),
                { session },
            );

            const totalRefunded = approvedContributions.reduce((s, c) => s + c.amountCredits, 0);
            if (campaign.creatorId) {
                await database.collection("user").updateOne(
                    { _id: campaign.creatorId, role: "creator" },
                    { $inc: { totalEarnedCredits: -totalRefunded, payoutBalanceCredits: -totalRefunded } },
                    { session },
                );
            }

            await contributions.updateMany(
                { campaignId: id, status: "approved" },
                { $set: { status: "refunded", updatedAt: now } },
                { session },
            );
        }

        await campaigns.deleteOne({ _id: id }, { session });
        return { deleted: true, campaignId };
    });
}

// ─────────────────────────────────────────────────────────────────
//  WITHDRAWAL REQUESTS
// ─────────────────────────────────────────────────────────────────

/**
 * Lists all pending withdrawal requests across all creators.
 */
export async function listPendingWithdrawals(database, actor) {
    requireAdmin(actor);
    return database.collection("withdrawal")
        .find({ status: "pending" })
        .project({ accountNumber: 0 })
        .sort({ createdAt: 1 })
        .toArray();
}

/**
 * Marks a withdrawal as approved and decrements the creator's payout balance.
 */
export async function processWithdrawal(database, client, actor, withdrawalId, now = new Date()) {
    requireAdmin(actor);
    const id = toObjectId(withdrawalId);

    return transaction(client, async (session) => {
        const withdrawals = database.collection("withdrawal");
        const withdrawal = await withdrawals.findOne({ _id: id, status: "pending" }, { session });
        if (!withdrawal) throw new AdminServiceError(404, "Withdrawal request not found or already processed.");

        const updated = await withdrawals.updateOne(
            { _id: id, status: "pending" },
            { $set: { status: "approved", processedAt: now, updatedAt: now } },
            { session },
        );
        if (updated.modifiedCount !== 1) throw new AdminServiceError(409, "Withdrawal was already processed.");

        // Decrement the creator's pending and payout balances.
        await database.collection("user").updateOne(
            { _id: withdrawal.creatorId, role: "creator" },
            {
                $inc: {
                    payoutBalanceCredits:     -withdrawal.withdrawalCredits,
                    pendingWithdrawalCredits: -withdrawal.withdrawalCredits,
                },
            },
            { session },
        );

        return { ...withdrawal, status: "approved", processedAt: now };
    });
}

// ─────────────────────────────────────────────────────────────────
//  REPORTS
// ─────────────────────────────────────────────────────────────────

/**
 * Lists all campaign reports, newest first.
 */
export async function listReports(database, actor) {
    requireAdmin(actor);
    return database.collection("report")
        .find({})
        .sort({ createdAt: -1 })
        .toArray();
}

/**
 * Lets a supporter file a report against a campaign.
 */
export async function fileReport(database, actor, input, now = new Date()) {
    if (!actor || actor.role !== "supporter") {
        throw new AdminServiceError(403, "Only Supporters can file reports.");
    }
    const campaignId = toObjectId(input.campaignId);
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    if (reason.length < 10 || reason.length > 2000) {
        throw new AdminServiceError(400, "Reason must be between 10 and 2,000 characters.");
    }

    const campaign = await database.collection("campaign").findOne(
        { _id: campaignId },
        { projection: { title: 1 } },
    );
    if (!campaign) throw new AdminServiceError(404, "Campaign not found.");

    const report = {
        campaignId,
        campaignTitle: campaign.title,
        reporterName:  actor.name,
        reporterEmail: actor.email,
        reason,
        status: "open",
        createdAt: now,
        updatedAt: now,
    };
    const inserted = await database.collection("report").insertOne(report);
    return { ...report, _id: inserted.insertedId };
}

/**
 * Admin resolves a report by suspending or deleting the campaign.
 * action: "suspend" | "delete" | "dismiss"
 */
export async function resolveReport(database, client, actor, reportId, action, now = new Date()) {
    requireAdmin(actor);
    if (!["suspend", "delete", "dismiss"].includes(action)) {
        throw new AdminServiceError(400, "Action must be suspend, delete, or dismiss.");
    }

    const id = toObjectId(reportId);
    return transaction(client, async (session) => {
        const reports   = database.collection("report");
        const campaigns = database.collection("campaign");

        const report = await reports.findOne({ _id: id, status: "open" }, { session });
        if (!report) throw new AdminServiceError(404, "Report not found or already resolved.");

        if (action === "suspend") {
            await campaigns.updateOne(
                { _id: report.campaignId },
                { $set: { status: "suspended", updatedAt: now } },
                { session },
            );
        } else if (action === "delete") {
            await campaigns.deleteOne({ _id: report.campaignId }, { session });
        }
        // "dismiss" takes no action on the campaign.

        await reports.updateOne(
            { _id: id },
            { $set: { status: action === "dismiss" ? "dismissed" : action + "d", resolvedAt: now, updatedAt: now } },
            { session },
        );

        return { reportId, action, resolvedAt: now };
    });
}
