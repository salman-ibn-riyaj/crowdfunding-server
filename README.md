# Crowdfunding API

Express 5 API with Better Auth sessions stored in MongoDB. Run the server with Node.js 20.19.0 or newer.

## Local setup

1. Copy `.env.example` to `.env` and fill in the Atlas connection string and a random `BETTER_AUTH_SECRET` of at least 32 characters.
2. In MongoDB Atlas, create a database user and allow the developer machine's current IP in Network Access. Prefer a dedicated least-privilege database user.
3. Set the Google OAuth callback URL to `http://localhost:4000/api/auth/callback/google`; keep both Google values empty to disable Google sign-in.
4. In the client, copy its `.env.example` to `.env.local` and keep `NEXT_PUBLIC_API_URL=http://localhost:4000`.
5. Start the API with `npm run dev`, then start the client with `npm run dev` in `crowdfunding-client`.

Never commit `.env` files, place server credentials in `NEXT_PUBLIC_*` variables, or share credentials in chat.

## API

- `GET /api/health` checks MongoDB availability.
- `GET /api/config` returns non-secret client configuration (currently Google sign-in availability).
- Better Auth email/password and Google routes are mounted under `/api/auth`.
- `POST /api/account/onboard` assigns Supporter or Creator and grants initial credits once. Admin is never a public registration role.

Use `npm run admin:promote -- user@example.com` to promote an existing account to Admin after confirming the target database. The dashboard navigation shell is ready; campaign, contribution, payment, withdrawal, and report workflows are intentionally deferred until their specifications are provided.