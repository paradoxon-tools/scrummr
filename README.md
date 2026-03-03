# Scrummer v1

Single-room scrum planning poker app built with Svelte 5 and Bun.

## Features

- Name-only login with local storage prefill and editable display name.
- Real-time multi-user voting in one shared room.
- Any participant can reveal estimates for everyone at once.
- After reveal, the action button becomes `Next ticket` to reset the round.

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
