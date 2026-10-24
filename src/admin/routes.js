import express from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../auth.js";
import { config } from "../config.js";
import { getDatabase, getMongoClient } from "../database.js";
import {
    AdminServiceError,
    adminDeleteCampaign,
    fileReport,
    getAdminSummary,
    listAllCampaigns,
    listAllUsers,
    listPendingCampaigns,
    listPendingWithdrawals,
    listReports,
    processWithdrawal,
    removeUser,
    resolveReport,
    updateUserRole,
} from "./service.js";
// Re-use the existing campaign-review function from the creator service.
import { reviewCampaignModeration, CreatorServiceError } from "../creator/service.js";

const router = express.Router();

function endpoint(handler, { mutating = false } = {}) {
    return async (request, response, next) => {
        try {
            if (mutating && request.get("origin") !== config.clientOrigin) {
                throw new AdminServiceError(403, "This origin is not allowed.");
            }
            await handler(request, response);
        } catch (error) {
            if (error instanceof AdminServiceError || error instanceof CreatorServiceError) {
                response.status(error.status).json({ message: error.message, errors: error.details });
                return;
            }
            next(error);
        }
    };
}

async function requireAdmin(request) {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!session) throw new AdminServiceError(401, "Sign in to continue.");
    if (session.user.role !== "admin") throw new AdminServiceError(403, "Admin access is required.");
    return session.user;
}

async function requireAuth(request) {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!session) throw new AdminServiceError(401, "Sign in to continue.");
    return session.user;
}

// ── Home stats ──────────────────────────────────────────────────
router.get("/admin/summary", endpoint(async (request, response) => {
    const user = await requireAdmin(request);
    response.json({ summary: await getAdminSummary(getDatabase(), user) });
}));

// ── Users ───────────────────────────────────────────────────────
router.get("/admin/users", endpoint(async (request, response) => {
    const user = await requireAdmin(request);
    response.json({ users: await listAllUsers(getDatabase(), user) });
}));

router.patch("/admin/users/:userId/role", endpoint(async (request, response) => {
    const user = await requireAdmin(request);
    const result = await updateUserRole(getDatabase(), user, request.params.userId, request.body?.role);
    response.json(result);
}, { mutating: true }));

router.delete("/admin/users/:userId", endpoint(async (request, response) => {
    const user = await requireAdmin(request);
    const result = await removeUser(getDatabase(), user, request.params.userId);
    response.json(result);
}, { mutating: true }));

// ── Campaign approvals (pending only) ───────────────────────────
router.get("/admin/campaigns/pending", endpoint(async (request, response) => {
    const user = await requireAdmin(request);
    response.json({ campaigns: await listPendingCampaigns(getDatabase(), user) });
}));

// Campaign approve / reject — delegates to existing reviewCampaignModeration
router.post("/admin/campaigns/:campaignId/review", endpoint(async (request, response) => {
    const user = await requireAdmin(request);
    const result = await reviewCampaignModeration(
        getDatabase(),
        user,
        request.params.campaignId,
        request.body?.decision,
    );
    response.json(result);
}, { mutating: true }));

// ── Manage campaigns (all) ───────────────────────────────────────
router.get("/admin/campaigns", endpoint(async (request, response) => {
    const user = await requireAdmin(request);
    response.json({ campaigns: await listAllCampaigns(getDatabase(), user) });
}));

router.delete("/admin/campaigns/:campaignId", endpoint(async (request, response) => {
    const user = await requireAdmin(request);
    const result = await adminDeleteCampaign(getDatabase(), getMongoClient(), user, request.params.campaignId);
    response.json(result);
}, { mutating: true }));

// ── Withdrawals ─────────────────────────────────────────────────
router.get("/admin/withdrawals", endpoint(async (request, response) => {
    const user = await requireAdmin(request);
    response.json({ withdrawals: await listPendingWithdrawals(getDatabase(), user) });
}));

router.post("/admin/withdrawals/:withdrawalId/process", endpoint(async (request, response) => {
    const user = await requireAdmin(request);
    const result = await processWithdrawal(getDatabase(), getMongoClient(), user, request.params.withdrawalId);
    response.json({ withdrawal: result });
}, { mutating: true }));

// ── Reports ─────────────────────────────────────────────────────
router.get("/admin/reports", endpoint(async (request, response) => {
    const user = await requireAdmin(request);
    response.json({ reports: await listReports(getDatabase(), user) });
}));

router.post("/admin/reports/:reportId/resolve", endpoint(async (request, response) => {
    const user = await requireAdmin(request);
    const result = await resolveReport(
        getDatabase(),
        getMongoClient(),
        user,
        request.params.reportId,
        request.body?.action,
    );
    response.json(result);
}, { mutating: true }));

// ── File a report (supporter-facing) ────────────────────────────
router.post("/campaigns/:campaignId/report", endpoint(async (request, response) => {
    const user = await requireAuth(request);
    const result = await fileReport(getDatabase(), user, {
        ...request.body,
        campaignId: request.params.campaignId,
    });
    response.status(201).json({ report: result });
}, { mutating: true }));

export { router as adminRouter };
