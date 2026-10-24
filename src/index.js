import cors from "cors";
import express from "express";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import { auth } from "./auth.js";
import { config } from "./config.js";
import { connectToDatabase, getDatabase, closeDatabase } from "./database.js";
import {
    assignRoleAndInitialCredits,
    OnboardingConflictError,
    PUBLIC_ROLES,
} from "./account/registration.js";
import { creatorRouter } from "./creator/routes.js";
import { supporterRouter } from "./supporter/routes.js";
import { adminRouter } from "./admin/routes.js";

const app = express();
app.disable("x-powered-by");
app.use(cors({
    origin: config.clientOrigin,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
}));

app.get("/api/config", (_request, response) => {
    response.set("Cache-Control", "no-store");
    response.json({ googleSignInEnabled: Boolean(config.googleClientId && config.googleClientSecret) });
});

app.get("/api/health", async (_request, response) => {
    try {
        await getDatabase().command({ ping: 1 });
        response.json({ status: "ok" });
    } catch {
        response.status(503).json({ status: "unavailable" });
    }
});

app.all("/api/auth/{*splat}", toNodeHandler(auth));
app.use(express.json({ limit: "16kb" }));
app.use("/api", creatorRouter);
app.use("/api", supporterRouter);
app.use("/api", adminRouter);

app.post("/api/account/onboard", async (request, response, next) => {
    try {
        if (request.get("origin") !== config.clientOrigin) {
            return response.status(403).json({ message: "This origin is not allowed." });
        }

        const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
        if (!session) return response.status(401).json({ message: "Sign in to finish account setup." });

        const role = request.body?.role;
        if (!PUBLIC_ROLES.includes(role)) {
            return response.status(400).json({ message: "Choose Supporter or Creator." });
        }

        const account = await assignRoleAndInitialCredits(
            getDatabase().collection("user"),
            session.user.id,
            role,
        );
        if (!account) return response.status(404).json({ message: "Account not found." });

        return response.json({ user: { ...session.user, ...account } });
    } catch (error) {
        if (error instanceof OnboardingConflictError) {
            return response.status(409).json({ message: error.message });
        }
        return next(error);
    }
});

app.use((error, _request, response, _next) => {
    console.error("API request failed", error instanceof Error ? error.name : "UnknownError");
    response.status(500).json({ message: "An unexpected server error occurred." });
});

const server = app.listen(config.port, async () => {
    try {
        await connectToDatabase();
        console.info(`Crowdfunding API listening on http://localhost:${config.port}`);
    } catch (error) {
        console.error(
            "Unable to connect to MongoDB. Check MONGODB_URI and Atlas network access.",
            error instanceof Error ? error.name : "UnknownError",
        );
        server.close(async () => {
            await closeDatabase();
            process.exitCode = 1;
        });
    }
});

async function shutdown() {
    server.close(async () => {
        await closeDatabase();
        process.exit(0);
    });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

export { app };