# Crowdfunding Platform — Server

REST API for a credit-based crowdfunding platform. It handles authentication, campaigns, contributions, withdrawals, notifications and image uploads. Built with **Node.js**, **Express**, **MongoDB** and **Better Auth**.

**API (production):** https://crowdfunding-server-ashy.vercel.app
**Client repo:** `YOUR_CLIENT_REPO_URL`
**Live site:** https://crowdfunding-client-liard.vercel.app

---

## Features

- Email and password authentication plus optional Google sign-in (Better Auth)
- Role system: `pending` (new user) → **Supporter** or **Creator**, plus **Admin**
- Initial credits assigned when a user completes onboarding
- Campaign lifecycle: submitted for Admin approval, active, funded, archived
- Credit-based contributions: credits are reserved on contribution, added to the campaign when the Creator approves, and refunded when the Creator rejects
- Creator withdrawals (20 credits = $1.00, minimum earned balance 200 credits) processed by Admin
- In-app notifications for campaign and contribution decisions
- Image upload through ImgBB
- Rate limiting on sign in and sign up
- Origin checks on sensitive endpoints, CORS with credentials

---

## Tech stack

| Area | Tools |
| --- | --- |
| Runtime | Node.js (ES modules) |
| Framework | Express |
| Database | MongoDB |
| Auth | Better Auth with the MongoDB adapter |
| Images | ImgBB API |
| Deployment | Vercel |

---

## Getting started

### Prerequisites
- Node.js 20 or newer
- A MongoDB database (MongoDB Atlas works well)

### Installation

```bash
git clone YOUR_SERVER_REPO_URL
cd crowdfunding-server
npm install
```

### Environment variables

Create a `.env` file in the project root:

```env
PORT=4000
MONGODB_URI=your-mongodb-connection-string
CLIENT_ORIGIN=http://localhost:3000

BETTER_AUTH_SECRET=a-long-random-secret
BETTER_AUTH_URL=http://localhost:4000

# Optional: enables Google sign-in
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Image upload
IMGBB_API_KEY=
```

> Variable names must match what `src/config.js` reads. Never commit `.env`.

### Run locally

```bash
npm run dev
```

The API starts at http://localhost:4000 and restarts on file changes (`node --watch`).

---

## API overview

All routes are prefixed with `/api`.

| Method | Route | Description |
| --- | --- | --- |
| GET | `/api/health` | Database health check |
| GET | `/api/config` | Public config (whether Google sign-in is enabled) |
| ALL | `/api/auth/*` | Better Auth endpoints (sign in, sign up, session, Google OAuth) |
| POST | `/api/account/onboard` | Choose Supporter or Creator and receive initial credits |
| POST | `/api/upload-image` | Upload a base64 image to ImgBB |
| GET | `/api/campaigns` | List public campaigns |
| GET | `/api/notifications` | Notifications for the signed-in user |
| GET | `/api/notifications/unread-count` | Unread notification count |
| POST | `/api/notifications/read` | Mark all notifications as read |

Creator, Supporter and Admin routes (campaign management, contributions, withdrawals, approvals) are defined in `src/creator/routes.js`, `src/supporter/routes.js` and `src/admin/routes.js`. Protected routes require a signed-in session with the right role.

---

## Project structure

```text
src/
├── index.js               # Express app (exported for Vercel)
├── auth.js                # Better Auth configuration
├── config.js              # Environment configuration
├── database.js            # MongoDB connection
├── account/               # Registration and onboarding logic
├── creator/               # Creator routes and services
├── supporter/             # Supporter routes
├── admin/                 # Admin routes and services
├── notifications/         # Notification routes and services
└── utils/
    └── image-upload.js    # ImgBB upload helper
```

---

## Deployment (Vercel)

1. Import the repository in Vercel.
2. Add every environment variable from the list above in **Settings → Environment Variables**.
   - `CLIENT_ORIGIN` must be the exact client URL with no trailing slash.
   - `BETTER_AUTH_URL` must be this server's own URL.
3. In MongoDB Atlas, allow network access from Vercel (**Network Access → `0.0.0.0/0`**), because Vercel IPs change.
4. Deploy. `src/index.js` exports the Express app as the default export, which Vercel runs as a function.

### Cross-site cookies

The client and server are on different domains. In production the server sets session cookies with `SameSite=None; Secure`, and the client sends requests with `credentials: "include"`. If login appears to succeed but you are sent back to the sign-in page, check the `set-cookie` header on the sign-in response first.

---

## Demo accounts

| Role | Email | Password |
| --- | --- | --- |
| Admin | `ADMIN_EMAIL` | `ADMIN_PASSWORD` |
| Creator | `CREATOR_EMAIL` | `CREATOR_PASSWORD` |
| Supporter | `SUPPORTER_EMAIL` | `SUPPORTER_PASSWORD` |

---

## Author

**Salman** — Junior MERN stack developer
GitHub: [salman-ibn-riyaj](https://github.com/salman-ibn-riyaj) · Portfolio: https://salman-shah-portfolio.vercel.app