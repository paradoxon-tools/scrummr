# Scrummer v1

Single-room scrum planning poker app built with Next.js + Convex.

## Features

- Name-only login with local storage prefill and editable display name.
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
npm install
```

Set your Convex deployment URL:

```bash
# .env.local
NEXT_PUBLIC_CONVEX_URL=https://<your-deployment>.convex.cloud
```

Run frontend + Convex together:

```bash
npm run dev:all
```

Or run them separately:

```bash
npm run dev:convex
```

```bash
npm run dev
```

The frontend runs on `http://localhost:5173`.

## Optional configuration

- `NEXT_PUBLIC_CONVEX_URL` points the app to your Convex deployment.
- `NEXT_PUBLIC_API_BASE_URL` overrides the base URL for backend HTTP calls (used by Jira integration).

## Deploy to Vercel with Convex

This repo includes a `build:vercel` script that deploys Convex first, then builds Next.js:

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

- `NEXT_PUBLIC_CONVEX_URL` is injected during the build by `convex deploy --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL`.
- You do not need to manually set `NEXT_PUBLIC_CONVEX_URL` in Vercel when using this build flow.

## Jira integration notes

- Scrummer calls Jira through the Next.js route at `POST /api/jira/issues`.
- The Jira request uses the ticket prefix (project key, for example `TEAM`) to load tickets, then groups them by sprint so each current/future sprint appears as its own bucket.
- Successful Jira loads are stored in Convex room state so late joiners and other participants share the same ticket buckets.
- Ticket editor changes stay local to the room state and are broadcast to all connected users (no write-back to Jira yet).
- Presence badges in the editor are local-collaboration hints and are cleared when users blur fields or disconnect.
- Jira credentials are stored in your browser `localStorage` for convenience in this prototype.
- For Jira Cloud, use your Atlassian email and an API token.
