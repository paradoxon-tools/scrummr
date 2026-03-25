# Scrummr

This project has been refactored into two separate applications:

- `backend/`: a dedicated Spring Boot REST API
- `frontend/`: a SvelteKit frontend

The backend persists data in SQLite and can be built into a single Docker image that contains the application and its local database file.

## Project structure

```text
backend/
  Dockerfile
  build.gradle.kts
  settings.gradle.kts
  src/main/kotlin/...
  src/main/resources/...
frontend/
  package.json
  src/routes/+page.svelte
  src/lib/api.ts
```

## Backend

### Features

- Spring Boot 3
- Kotlin backend
- Gradle build
- REST API under `/api`
- SQLite persistence via JDBC
- Single-container Docker setup

### Run locally

```bash
gradle -p backend bootRun
```

The API runs on `http://localhost:8080`.

### Main endpoints

- `GET /api/health`
- `GET /api/todos`
- `POST /api/todos`
- `PUT /api/todos/{id}`
- `PATCH /api/todos/{id}/toggle`
- `DELETE /api/todos/{id}`

### Build jar

```bash
gradle -p backend build
```

### Build Docker image

```bash
docker build -t scrummr-backend ./backend
```

### Run with Docker Compose

```bash
docker compose up --build
```

This creates a named volume for the SQLite database at `/app/data/scrummr.db` inside the container.

## Frontend

### Features

- SvelteKit UI
- Talks directly to the Spring Boot backend
- Simple todo workflow for verifying the split architecture end-to-end

### Install and run

```bash
cd frontend
npm install
npm run dev
```

The frontend runs on `http://localhost:5173` by default.

### Environment

Copy `frontend/.env.example` to `frontend/.env` if you need to change the backend URL:

```bash
VITE_API_BASE_URL=http://localhost:8080
```

## Root helper scripts

From the repository root:

```bash
npm run frontend:dev
npm run frontend:build
npm run backend:run
npm run backend:build
npm run backend:docker
npm run backend:compose
```

## Notes

- The old TanStack Start / Convex / Clerk scaffold is no longer the primary app architecture.
- SQLite schema is initialized automatically from `backend/src/main/resources/schema.sql`.
- For production, you will usually want to set `FRONTEND_ORIGIN` when running the backend container.
- If you want fully reproducible local Gradle usage, the next step would be adding the Gradle wrapper (`gradlew`, `gradlew.bat`, and `gradle/wrapper/*`).
