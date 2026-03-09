# Scrummr Agent Guide

## Project overview

- Scrummr is a TanStack Start + Vite frontend backed by Convex.
- Use Bun as the package manager and runtime.
- Deployments go through Vercel, with Convex deployed as part of the Vercel build flow.

## Source-of-truth commands

- Install dependencies: `bun install`
- Run frontend + Convex locally: `bun run dev`
- Seed Convex once, then run full dev flow: `bun run dev:all`
- Run frontend only: `bun run dev:web`
- Run Convex only: `bun run dev:convex`
- Build production assets: `bun run build`
- Preview the production build locally: `bun run start`
- Required verification before code commits: `bun run check`
- Run type checks only: `bun run typecheck`
- Run the Vercel/Convex deployment build: `bun run build:vercel`

Do not invent commands that do not exist in this repo.

- There is no dedicated `test` script today.
- There is no dedicated `lint` script wired for routine use today.
- Do not claim to have run `bun test` or `bun run lint` unless you added those scripts as part of the task.

## Deploy guidance

- Vercel uses `bun run build:vercel`.
- `build:vercel` runs `sync-convex-preview-env.mjs`, then `convex deploy --cmd "bun run build" --cmd-url-env-var-name VITE_CONVEX_URL`.
- `vercel.json` sets `buildCommand` to `bun run build:vercel` and `outputDirectory` to `dist/client`.
- `CONVEX_DEPLOY_KEY` is required in Vercel.
- Preview env sync depends on `VERCEL_ENV`, `VERCEL_GIT_COMMIT_REF`, and `CLERK_FRONTEND_API_URL`.
- Agents may use `bun run build:vercel` to validate deploy behavior locally, but must not trigger production deployment work unless the user explicitly asks for it.

## Working rules

- Always commit and push: every completed task that changes tracked files must end with git commits and a push to the current branch.
- Use granular commits: when work naturally splits into milestones, make multiple small local commits grouped by intent.
- Default push timing: make granular local commits during the task, then push once at the end after the final commit.
- If push fails due to credentials, branch protection, remote divergence, or network issues, report that explicitly.
- Keep changes minimal: touch only files required for the task, prefer surgical edits, and avoid unrelated cleanup or reformatting.
- Preserve existing patterns unless the task specifically requires changing them.

## Verification rules

- Run `bun run check` before committing code changes unless the user explicitly says not to or the environment makes it impossible.
- If `bun run check` cannot run, state that clearly and explain why.
- For docs-only changes, verification can be skipped; state that the change is documentation-only.

## Generated and ignored files

Tracked generated files may need to be committed when regenerated:

- `app/routeTree.gen.ts`
- `convex/_generated/*`

Ignored build artifacts must not be committed:

- `dist/`
- `.next/`
- `.tanstack/`
- `*.tsbuildinfo`

## Environment notes

- Local environment variables live in `.env.local`.
- Full setup and required Convex, Clerk, and Jira/Atlassian OAuth variables are documented in `README.md`.
- Reference `README.md` for the complete environment list instead of duplicating it here.
