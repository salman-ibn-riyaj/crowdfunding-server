import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../auth.js";
import { CreatorServiceError } from "../creator/service.js";
import { SupporterServiceError } from "../supporter/service.js";
import { AdminServiceError } from "../admin/service.js";

/**
 * Centralized authorization middleware for role-based access control.
 * All functions validate the session and return the user object if authorized.
 * Throws appropriate service errors if unauthorized.
 */

/**
 * Require user to be authenticated (any role).
 * @param {import('express').Request} request
 * @returns {Promise<Object>} User object from session
 */
export async function requireAuth(request) {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!session) {
        throw new Error("Sign in to continue.");
    }
    return session.user;
}

/**
 * Require user to be authenticated and have supporter role.
 * @param {import('express').Request} request
 * @returns {Promise<Object>} User object from session
 */
export async function requireSupporter(request) {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!session) {
        throw new SupporterServiceError(401, "Sign in to continue.");
    }
    if (session.user.role !== "supporter") {
        throw new SupporterServiceError(403, "Supporter access is required.");
    }
    return session.user;
}

/**
 * Require user to be authenticated and have creator role.
 * @param {import('express').Request} request
 * @returns {Promise<Object>} User object from session
 */
export async function requireCreator(request) {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!session) {
        throw new CreatorServiceError(401, "Sign in to continue.");
    }
    if (session.user.role !== "creator") {
        throw new CreatorServiceError(403, "Creator access is required.");
    }
    return session.user;
}

/**
 * Require user to be authenticated and have admin role.
 * @param {import('express').Request} request
 * @returns {Promise<Object>} User object from session
 */
export async function requireAdmin(request) {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!session) {
        throw new AdminServiceError(401, "Sign in to continue.");
    }
    if (session.user.role !== "admin") {
        throw new AdminServiceError(403, "Admin access is required.");
    }
    return session.user;
}

/**
 * Require user to be authenticated with a specific role.
 * @param {import('express').Request} request
 * @param {string} expectedRole - One of "supporter", "creator", "admin"
 * @returns {Promise<Object>} User object from session
 */
export async function requireRole(request, expectedRole) {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!session) {
        throw new Error("Sign in to continue.");
    }
    if (expectedRole && session.user.role !== expectedRole) {
        const errorClass = expectedRole === "admin" ? AdminServiceError :
                          expectedRole === "creator" ? CreatorServiceError :
                          SupporterServiceError;
        throw new errorClass(403, `${expectedRole[0].toUpperCase()}${expectedRole.slice(1)} access is required.`);
    }
    return session.user;
}
