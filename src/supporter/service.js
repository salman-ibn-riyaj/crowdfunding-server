import { ObjectId } from "mongodb";

export class SupporterServiceError extends Error {
    constructor(status, message, details) {
        super(message);
        this.name = "SupporterServiceError";
        this.status = status;
        this.details = details;
    }
}

// Credit packages available for purchase. 20 credits = $1.00 (each credit = $0.05).
export const CREDIT_PACKAGES = Object.freeze([
    { id: "pkg_100", credits: 100, priceCents: 1000, label: "100 credits" },
    { id: "pkg_300", credits: 300, priceCents: 2500, label: "300 credits" },
    { id: "pkg_800", credits: 800, priceCents: 6000, label: "800 credits" },
    { id: "pkg_1500", credits: 1500, priceCents: 11000, label: "1500 credits" },
]);

function toObjectId(value) {
    if (!ObjectId.isValid(value)) throw new SupporterServiceError(400, "Invalid resource ID.");
    return new ObjectId(value);
}

function supporterId(actor) {
    if (!actor || actor.role !== "supporter") {
        throw new SupporterServiceError(403, "Supporter access is required.");
    }
    return toObjectId(actor.id);
}

/**
 * Returns summary stats for the supporter's dashboard home.
 */
export async function getSupporterSummary(database, actor) {
    const ownerId = supporterId(actor);
    const contributions = database.collection("contribution");

    const [totalCount, pendingCount, approvedAgg] = await Promise.all([
        contributions.countDocuments({ supporterId: ownerId }),
        contributions.countDocuments({ supporterId: ownerId, status: "pending" }),
        contributions.aggregate([
            { $match: { supporterId: ownerId, status: "approved" } },
            { $group: { _id: null, totalApprovedCredits: { $sum: "$amountCredits" } } },
        ]).toArray(),
    ]);

    return {
        totalContributions: totalCount,
        pendingContributions: pendingCount,
        totalApprovedCredits: approvedAgg[0]?.totalApprovedCredits || 0,
    };
}

/**
 * Returns all contributions made by this supporter with latest-first ordering.
 * Supports pagination with page and limit parameters.
 */
export async function listSupporterContributions(database, actor, page = 1, limit = 10) {
    const ownerId = supporterId(actor);
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 10));
    const skip = (pageNum - 1) * limitNum;

    const [contributions, total] = await Promise.all([
        database.collection("contribution")
            .find({ supporterId: ownerId })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limitNum)
            .toArray(),
        database.collection("contribution").countDocuments({ supporterId: ownerId }),
    ]);

    return {
        contributions,
        pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            totalPages: Math.ceil(total / limitNum),
            hasNext: pageNum * limitNum < total,
            hasPrev: pageNum > 1,
        },
    };
}

/**
 * Returns only approved contributions made by this supporter.
 */
export async function listApprovedContributions(database, actor) {
    const ownerId = supporterId(actor);
    return database.collection("contribution")
        .find({ supporterId: ownerId, status: "approved" })
        .sort({ createdAt: -1 })
        .toArray();
}

/**
 * Records a dummy credit purchase and increments the supporter's credits.
 * In production this would be driven by a Stripe webhook.
 */
export async function createCreditPurchase(database, actor, input, now = new Date()) {
    const ownerId = supporterId(actor);
    const pkg = CREDIT_PACKAGES.find((p) => p.id === input.packageId);
    if (!pkg) throw new SupporterServiceError(400, "Invalid credit package selected.");

    const paymentMethod = typeof input.paymentMethod === "string" ? input.paymentMethod.trim() : "";
    if (!paymentMethod) throw new SupporterServiceError(400, "Choose a payment method.");

    // Increment credits on the user document atomically.
    const result = await database.collection("user").updateOne(
        { _id: ownerId, role: "supporter" },
        { $inc: { credits: pkg.credits } },
    );
    if (result.modifiedCount !== 1) throw new SupporterServiceError(404, "Supporter account not found.");

    // Record the purchase for payment history.
    const purchase = {
        supporterId: ownerId,
        supporterEmail: actor.email,
        supporterName: actor.name,
        packageId: pkg.id,
        creditsAdded: pkg.credits,
        priceCents: pkg.priceCents,
        paymentMethod,
        status: "completed",
        createdAt: now,
    };
    const inserted = await database.collection("credit_purchase").insertOne(purchase);
    return { ...purchase, _id: inserted.insertedId };
}

/**
 * Returns all credit purchase history for this supporter (newest first).
 */
export async function listSupporterPayments(database, actor) {
    const ownerId = supporterId(actor);
    return database.collection("credit_purchase")
        .find({ supporterId: ownerId })
        .sort({ createdAt: -1 })
        .toArray();
}
