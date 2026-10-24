import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { config } from "./config.js";
import { getDatabase, getMongoClient } from "./database.js";
import { validateRegistrationInput } from "./account/registration.js";

const googleProvider = config.googleClientId
    ? {
        google: {
            clientId: config.googleClientId,
            clientSecret: config.googleClientSecret,
        },
    }
    : {};

export const auth = betterAuth({
    appName: "crowdfunding",
    baseURL: config.authUrl,
    basePath: "/api/auth",
    secret: config.authSecret,
    trustedOrigins: [config.clientOrigin],
    database: mongodbAdapter(getDatabase(), { client: getMongoClient(), transaction: true }),
    emailAndPassword: {
        enabled: true,
        autoSignIn: true,
        minPasswordLength: 12,
        maxPasswordLength: 128,
    },
    socialProviders: googleProvider,
    user: {
        additionalFields: {
            role: { type: "string", required: true, defaultValue: "pending", input: false },
            credits: { type: "number", required: true, defaultValue: 0, input: false },
            roleOnboarded: { type: "boolean", required: true, defaultValue: false, input: false },
        },
    },
    databaseHooks: {
        user: {
            create: {
                before: async (user) => ({
                    data: { ...user, role: "pending", credits: 0, roleOnboarded: false },
                }),
            },
        },
    },
    hooks: {
        before: createAuthMiddleware(async (context) => {
            if (context.path !== "/sign-up/email") return;

            const errors = validateRegistrationInput(context.body);
            const firstError = Object.values(errors)[0];
            if (firstError) {
                throw new APIError("BAD_REQUEST", { message: firstError });
            }
        }),
    },
    rateLimit: {
        enabled: true,
        storage: "memory",
        customRules: {
            "/sign-in/email": { window: 60, max: 5 },
            "/sign-up/email": { window: 60, max: 3 },
        },
    },
    advanced: {
        useSecureCookies: config.isProduction,
    },
    trustedOrigins: [config.clientOrigin],
    advanced: {
        defaultCookieAttributes: {
            sameSite: "none",
            secure: true,
        },
    },
});