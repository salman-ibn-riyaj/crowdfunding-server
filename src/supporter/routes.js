import express from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../auth.js";
import { config } from "../config.js";
import { getDatabase } from "../database.js";
import {
    createCreditPurchase,
    getSupporterSummary,
    listApprovedContributions,
    listSupporterContributions,
    listSupporterPayments,
    SupporterServiceError,
} from "./service.js";

const router = express.Router();

function endpoint(handler, { mutating = false } = {}) {
    return async (request, response, next) => {
        try {
            if (mutating && request.get("origin") !== config.clientOrigin) {
                throw new SupporterServiceError(403, "This origin is not allowed.");
            }
            await handler(request, response);
        } catch (error) {
            if (error instanceof SupporterServiceError) {
                response.status(error.status).json({ message: error.message, errors: error.details });
                return;
            }
            next(error);
        }
    };
}

async function requireSupporter(request) {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!session) throw new SupporterServiceError(401, "Sign in to continue.");
    if (session.user.role !== "supporter") {
        throw new SupporterServiceError(403, "Supporter access is required.");
    }
    return session.user;
}

// GET /api/supporter/summary — home stats
router.get("/supporter/summary", endpoint(async (request, response) => {
    const user = await requireSupporter(request);
    response.json({ summary: await getSupporterSummary(getDatabase(), user) });
}));

// GET /api/supporter/contributions — all contributions by this supporter
router.get("/supporter/contributions", endpoint(async (request, response) => {
    const user = await requireSupporter(request);
    response.json({ contributions: await listSupporterContributions(getDatabase(), user) });
}));

// GET /api/supporter/contributions/approved — approved contributions only
router.get("/supporter/contributions/approved", endpoint(async (request, response) => {
    const user = await requireSupporter(request);
    response.json({ contributions: await listApprovedContributions(getDatabase(), user) });
}));

// POST /api/supporter/credits/purchase — buy a credit package (dummy payment)
router.post("/supporter/credits/purchase", endpoint(async (request, response) => {
    const user = await requireSupporter(request);
    const purchase = await createCreditPurchase(getDatabase(), user, request.body);
    response.status(201).json({ purchase });
}, { mutating: true }));

// GET /api/supporter/payments — credit purchase history
router.get("/supporter/payments", endpoint(async (request, response) => {
    const user = await requireSupporter(request);
    response.json({ payments: await listSupporterPayments(getDatabase(), user) });
}));

export { router as supporterRouter };
