import "dotenv/config";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim();
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();

if (Boolean(googleClientId) !== Boolean(googleClientSecret)) {
  throw new Error("Set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or leave both empty.");
}

export const config = {
  port: Number(process.env.PORT || 4000),
  clientOrigin: process.env.CLIENT_ORIGIN || "http://localhost:3000",
  authUrl: process.env.BETTER_AUTH_URL || "http://localhost:4000",
  authSecret: required("BETTER_AUTH_SECRET"),
  mongoUri: required("MONGODB_URI"),
  mongoDbName: process.env.MONGODB_DB?.trim() || undefined,
  googleClientId,
  googleClientSecret,
  isProduction: process.env.NODE_ENV === "production",
};

if (config.authSecret.length < 32) {
  throw new Error("BETTER_AUTH_SECRET must be at least 32 characters long.");
}

if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
  throw new Error("PORT must be a valid TCP port.");
}