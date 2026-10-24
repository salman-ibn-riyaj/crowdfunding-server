import express from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../auth.js";
import { getDatabase } from "../database.js";
import { listNotifications, markAllRead, countUnread } from "./service.js";

const router = express.Router();

async function requireAuth(request) {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!session) {
        const error = new Error("Sign in to continue.");
        error.status = 401;
        throw error;
    }
    return session.user;
}

function endpoint(handler) {
    return async (request, response, next) => {
        try {
            await handler(request, response);
        } catch (error) {
            if (error.status) {
                response.status(error.status).json({ message: error.message });
                return;
            }
            next(error);
        }
    };
}

// GET /api/notifications — fetch all for the logged-in user
router.get("/notifications", endpoint(async (request, response) => {
    const user = await requireAuth(request);
    const notifications = await listNotifications(getDatabase(), user.email);
    response.json({ notifications });
}));

// GET /api/notifications/unread-count — lightweight badge count
router.get("/notifications/unread-count", endpoint(async (request, response) => {
    const user = await requireAuth(request);
    const count = await countUnread(getDatabase(), user.email);
    response.json({ count });
}));

// POST /api/notifications/read — mark all as read
router.post("/notifications/read", endpoint(async (request, response) => {
    const user = await requireAuth(request);
    await markAllRead(getDatabase(), user.email);
    response.json({ ok: true });
}));

export { router as notificationsRouter };
