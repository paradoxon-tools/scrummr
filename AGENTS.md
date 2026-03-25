# AGENTS.md

## Project architecture

This repository is split into two separate applications:

- `backend/`: Spring Boot backend built with Gradle and Kotlin
  - Provides the REST API under `/api`
  - Uses SQLite for persistence
  - Can be bundled into a Docker image
- `frontend/`: SvelteKit frontend
  - Talks to the backend over HTTP
  - Uses `VITE_API_BASE_URL` to locate the API

## Working guidelines

- Treat `backend/` and `frontend/` as separate applications with a clear API boundary.
- Prefer making changes in the appropriate app instead of re-introducing a monolithic setup.
- Keep backend API changes and frontend client changes consistent.
- When changing backend endpoints, also update any affected frontend API calls and documentation.
- When changing build or runtime behavior, update `README.md` and any relevant config files.

## Backend rules

- Use Kotlin for backend code; do not add new Java source files unless explicitly requested.
- Use Gradle, not Maven.
- Prefer commands like:
  - `gradle -p backend bootRun`
  - `gradle -p backend build`
- Keep SQLite as the default embedded database unless explicitly asked otherwise.
- Preserve Docker support for the backend.

## Frontend rules

- Use SvelteKit for frontend work.
- Keep backend base URL configurable via environment variables.
- Prefer simple, typed API helpers for backend communication.

## Commit policy

- Always create a git commit for completed work.
- After finishing a task that changes files, make a commit with a clear, concise message.
- Do not consider the task fully complete until the commit has been created successfully.
- If a task is only partially completed or blocked, clearly say so instead of making a misleading commit.

## Documentation policy

- Keep this split architecture reflected in docs.
- If the structure changes, update this file accordingly.
