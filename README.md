# Scrummer v1

Single-room scrum planning poker app built with Svelte 5 and Bun.

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
bun install
```

Run both backend and frontend together:

```bash
bun run dev:all
```

Or run them separately in two terminals:

```bash
bun run dev:server
```

```bash
bun run dev
```

The frontend runs on Vite's default port (`5173`) and connects to `ws://localhost:3001/ws`.

## Optional configuration

- `WS_PORT` controls the Bun WebSocket server port (default `3001`).
- `VITE_WS_URL` overrides the client WebSocket URL.
- `VITE_API_BASE_URL` overrides the base URL for backend HTTP calls (used by Jira integration).

## Jira integration notes

- Scrummer calls Jira through the Bun backend at `POST /api/jira/issues`.
- The Jira request uses the ticket prefix (project key, for example `TEAM`) to load tickets, then groups them by sprint so each current/future sprint appears as its own bucket.
- Successful Jira loads are stored on the server and broadcast through room snapshots so late joiners and other participants share the same ticket buckets.
- Ticket editor changes stay local to the room state and are broadcast to all connected users (no write-back to Jira yet).
- Presence badges in the editor are local-collaboration hints and are cleared when users blur fields or disconnect.
- Jira credentials are stored in your browser `localStorage` for convenience in this prototype.
- For Jira Cloud, use your Atlassian email and an API token.
