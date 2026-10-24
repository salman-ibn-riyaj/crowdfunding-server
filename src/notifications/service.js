import { ObjectId } from "mongodb";

// ─────────────────────────────────────────────────────────────────
//  Notification templates
//  All messages use plain-text interpolation so nothing can inject
//  HTML into the client.
// ─────────────────────────────────────────────────────────────────

export const NotificationType = Object.freeze({
    CONTRIBUTION_CREATED:   "contribution_created",   // supporter → creator
    CONTRIBUTION_APPROVED:  "contribution_approved",  // creator   → supporter
    CONTRIBUTION_REJECTED:  "contribution_rejected",  // creator   → supporter
    CAMPAIGN_APPROVED:      "campaign_approved",       // admin     → creator
    CAMPAIGN_REJECTED:      "campaign_rejected",       // admin     → creator
    WITHDRAWAL_PROCESSED:   "withdrawal_processed",   // admin     → creator
});

/**
 * Builds the notification message + metadata for a given event type.
 * Returns { message, toEmail, actionRoute } — caller adds `time` + `read`.
 */
export function buildNotification(type, payload) {
    switch (type) {
        case NotificationType.CONTRIBUTION_CREATED:
            return {
                message: `${payload.supporterName} contributed ${payload.amountCredits} credits to your campaign "${payload.campaignTitle}".`,
                toEmail: payload.creatorEmail,
                actionRoute: "/dashboard?section=contributions",
            };
        case NotificationType.CONTRIBUTION_APPROVED:
            return {
                message: `Your contribution of ${payload.amountCredits} credits to "${payload.campaignTitle}" was approved by ${payload.creatorName}.`,
                toEmail: payload.supporterEmail,
                actionRoute: "/dashboard?section=contributions",
            };
        case NotificationType.CONTRIBUTION_REJECTED:
            return {
                message: `Your contribution of ${payload.amountCredits} credits to "${payload.campaignTitle}" was rejected by ${payload.creatorName}. Your credits have been refunded.`,
                toEmail: payload.supporterEmail,
                actionRoute: "/dashboard?section=contributions",
            };
        case NotificationType.CAMPAIGN_APPROVED:
            return {
                message: `Your campaign "${payload.campaignTitle}" has been approved and is now visible to Supporters.`,
                toEmail: payload.creatorEmail,
                actionRoute: "/dashboard?section=campaigns",
            };
        case NotificationType.CAMPAIGN_REJECTED:
            return {
                message: `Your campaign "${payload.campaignTitle}" was not approved by the admin.`,
                toEmail: payload.creatorEmail,
                actionRoute: "/dashboard?section=campaigns",
            };
        case NotificationType.WITHDRAWAL_PROCESSED:
            return {
                message: `Your withdrawal of ${payload.withdrawalCredits} credits ($${(payload.withdrawalAmountCents / 100).toFixed(2)}) has been processed via ${payload.paymentSystem}.`,
                toEmail: payload.creatorEmail,
                actionRoute: "/dashboard?section=payments",
            };
        default:
            throw new Error(`Unknown notification type: ${type}`);
    }
}

/**
 * Inserts a single notification document into the `notification` collection.
 * Fire-and-forget: callers should call this without awaiting in non-critical paths,
 * but we export it as async so tests can await it.
 */
export async function createNotification(database, type, payload, now = new Date()) {
    const { message, toEmail, actionRoute } = buildNotification(type, payload);
    const doc = { message, toEmail, actionRoute, time: now, read: false };
    await database.collection("notification").insertOne(doc);
    return doc;
}

/**
 * Returns all notifications for `email`, sorted newest-first.
 */
export async function listNotifications(database, email) {
    if (!email) return [];
    return database.collection("notification")
        .find({ toEmail: email })
        .sort({ time: -1 })
        .toArray();
}

/**
 * Marks all unread notifications for `email` as read.
 */
export async function markAllRead(database, email) {
    if (!email) return;
    await database.collection("notification").updateMany(
        { toEmail: email, read: false },
        { $set: { read: true } },
    );
}

/**
 * Returns the count of unread notifications for `email`.
 */
export async function countUnread(database, email) {
    if (!email) return 0;
    return database.collection("notification").countDocuments({ toEmail: email, read: false });
}

/**
 * Convenience: insert notification without blocking the calling route.
 * Swallows errors so a notification failure never breaks the main response.
 */
export function notifyAsync(database, type, payload) {
    createNotification(database, type, payload).catch((err) => {
        console.error("[notification] Failed to insert:", err?.message);
    });
}
