import express from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../auth.js";
import { config } from "../config.js";
import { getDatabase, getMongoClient } from "../database.js";
import {
    archiveOrDeleteCampaign,
    createCampaign,
    createContribution,
    createWithdrawalRequest,
    CreatorServiceError,
    getCreatorSummary,
    getPublicCampaign,
    listCreatorCampaigns,
    listCreatorWithdrawals,
    listPendingContributions,
    listPublicCampaigns,
    reviewCampaignModeration,
    reviewContribution,
    updateCampaign,
} from "./service.js";

const router = express.Router();

function endpoint(handler, { mutating = false } = {}) {
    return async (request, response, next) => {
        try {
            if (mutating && request.get("origin") !== config.clientOrigin) {
                throw new CreatorServiceError(403, "This origin is not allowed.");
            }
            await handler(request, response);
        } catch (error) {
            if (error instanceof CreatorServiceError) {
                response.status(error.status).json({ message: error.message, errors: error.details });
                return;
            }
            next(error);
        }
    };
}

async function requireUser(request, expectedRole) {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!session) throw new CreatorServiceError(401, "Sign in to continue.");
    if (expectedRole && session.user.role !== expectedRole) {
        throw new CreatorServiceError(403, `${expectedRole[0].toUpperCase()}${expectedRole.slice(1)} access is required.`);
    }
    return session.user;
}

router.get("/campaigns", endpoint(async (_request, response) => {
    response.json({ campaigns: await listPublicCampaigns(getDatabase()) });
}));

router.get("/campaigns/:campaignId", endpoint(async (request, response) => {
    const campaign = await getPublicCampaign(getDatabase(), request.params.campaignId);
    response.json({ campaign });
}));

router.post("/campaigns/:campaignId/contributions", endpoint(async (request, response) => {
    const user = await requireUser(request, "supporter");
    const contribution = await createContribution(
        getDatabase(),
        getMongoClient(),
        user,
        { ...request.body, campaignId: request.params.campaignId },
    );
    response.status(201).json({ contribution });
}, { mutating: true }));

router.get("/creator/summary", endpoint(async (request, response) => {
    const user = await requireUser(request, "creator");
    response.json({ summary: await getCreatorSummary(getDatabase(), user) });
}));

router.get("/creator/campaigns", endpoint(async (request, response) => {
    const user = await requireUser(request, "creator");
    response.json({ campaigns: await listCreatorCampaigns(getDatabase(), user) });
}));

router.post("/creator/campaigns", endpoint(async (request, response) => {
    const user = await requireUser(request, "creator");
    const campaign = await createCampaign(getDatabase(), user, request.body);
    response.status(201).json({ campaign });
}, { mutating: true }));

router.patch("/creator/campaigns/:campaignId", endpoint(async (request, response) => {
    const user = await requireUser(request, "creator");
    const campaign = await updateCampaign(getDatabase(), user, request.params.campaignId, request.body);
    response.json({ campaign });
}, { mutating: true }));

router.delete("/creator/campaigns/:campaignId", endpoint(async (request, response) => {
    const user = await requireUser(request, "creator");
    const result = await archiveOrDeleteCampaign(
        getDatabase(),
        getMongoClient(),
        user,
        request.params.campaignId,
    );
    response.json(result);
}, { mutating: true }));

router.get("/creator/contributions/pending", endpoint(async (request, response) => {
    const user = await requireUser(request, "creator");
    response.json({ contributions: await listPendingContributions(getDatabase(), user) });
}));

router.post("/creator/contributions/:contributionId/approve", endpoint(async (request, response) => {
    const user = await requireUser(request, "creator");
    const contribution = await reviewContribution(
        getDatabase(),
        getMongoClient(),
        user,
        request.params.contributionId,
        "approve",
    );
    response.json({ contribution });
}, { mutating: true }));

router.post("/creator/contributions/:contributionId/reject", endpoint(async (request, response) => {
    const user = await requireUser(request, "creator");
    const contribution = await reviewContribution(
        getDatabase(),
        getMongoClient(),
        user,
        request.params.contributionId,
        "reject",
    );
    response.json({ contribution });
}, { mutating: true }));

router.post("/creator/withdrawals", endpoint(async (request, response) => {
    const user = await requireUser(request, "creator");
    const withdrawal = await createWithdrawalRequest(
        getDatabase(),
        getMongoClient(),
        user,
        request.body,
    );
    const { accountNumber: _accountNumber, ...publicWithdrawal } = withdrawal;
    response.status(201).json({ withdrawal: publicWithdrawal });
}, { mutating: true }));

router.get("/creator/withdrawals", endpoint(async (request, response) => {
    const user = await requireUser(request, "creator");
    response.json({ withdrawals: await listCreatorWithdrawals(getDatabase(), user) });
}));

export { router as creatorRouter };