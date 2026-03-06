# Scrummr v1

Single-room scrum planning poker app built with TanStack Start + Convex.

## Features

- Name-only login with local storage prefill and editable display name.
- Per-user light/dark mode toggle stored in local browser preferences.
- Real-time multi-user voting in one shared room.
- Any participant can reveal estimates for everyone at once.
- After reveal, the action button becomes `Next ticket` to reset the round.
- Jira integration panel to configure credentials + ticket prefix and load tickets grouped by their assigned sprint (current/future) plus unsprinted backlog candidates.
- Jira loads are shared at room level: once one participant refreshes tickets, everyone sees the same list.
- Click any Jira ticket to open a shared in-room ticket editor with local field edits and subtasks.
- Live field/subtask presence indicators show who is currently editing what.

## Run locally

Install dependencies:

```bash
bun install
```

Set your environment variables:

```bash
# .env.local
VITE_CONVEX_URL=https://<your-deployment>.convex.cloud
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
CLERK_JWT_ISSUER_DOMAIN=https://<your-clerk-domain>
```

Run frontend + Convex together:

```bash
bun run dev
```

Or run them separately:

```bash
bun run dev:convex
```

```bash
bun run dev:web
```

The frontend runs on `http://localhost:5173`.

## Optional configuration

- `VITE_CONVEX_URL` points the app to your Convex deployment.
- `VITE_CLERK_PUBLISHABLE_KEY` is required for Clerk in the frontend.
- `CLERK_SECRET_KEY` is required for Clerk server operations.
- `CLERK_JWT_ISSUER_DOMAIN` is required by Convex auth config.

## Deploy to Vercel with Convex

This repo includes a `build:vercel` script that deploys Convex first, then builds the TanStack Start app:

```bash
bun run build:vercel
```

Set Vercel Build Command to:

```bash
bun run build:vercel
```

Set Vercel Install Command to:

```bash
bun install
```

Required Vercel environment variable:

- `CONVEX_DEPLOY_KEY` (create a production deploy key in Convex Dashboard and add it in Vercel)

Notes:

- `VITE_CONVEX_URL` is injected during the build by `convex deploy --cmd-url-env-var-name VITE_CONVEX_URL`.
- You do not need to manually set `VITE_CONVEX_URL` in Vercel when using this build flow.

## Jira integration notes

- Scrummr loads/syncs Jira through Convex actions (`convex/jira.ts`).
- The Jira request uses the ticket prefix (project key, for example `TEAM`) to load tickets, then groups them by sprint so each current/future sprint appears as its own bucket.
- Successful Jira loads are stored in Convex room state so late joiners and other participants share the same ticket buckets.
- Ticket editor changes stay local to the room state and are broadcast to all connected users (no write-back to Jira yet).
- Presence badges in the editor are local-collaboration hints and are cleared when users blur fields or disconnect.
- Jira credentials are stored in your browser `localStorage` for convenience in this prototype.
- For Jira Cloud, use your Atlassian email and an API token.
