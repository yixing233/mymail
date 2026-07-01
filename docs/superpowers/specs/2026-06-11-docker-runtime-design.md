# Docker Runtime Design

## Goal

Add a Docker-based runtime for this Next.js + SQLite project that supports both local development and production execution, with a dedicated development image and a dedicated production image.

## Current Context

- The app is a Next.js 16 project that listens on port `12121`.
- The current local run path is `npm install` then `npm run dev`.
- SQLite is initialized in `lib/db.ts`.
- The database path currently defaults to `process.cwd()/data/mymail.db` unless `MYMAIL_DB_PATH` is set.
- The repository currently does not contain committed Docker runtime files.

## Chosen Approach

Use two Dockerfiles:

- `Dockerfile.dev` for development
- `Dockerfile` for production

Use a single `docker-compose.yml` with two services:

- `app-dev` for hot-reload development
- `app-prod` for production-style runtime

Use bind mounts for source code in development and a named Docker volume for SQLite data in both development and production.

## Why This Approach

This keeps development and production concerns separate instead of forcing one file to carry both behaviors. It also matches the project's current needs:

- development needs source mounts and fast iteration
- production needs a small runtime image and deterministic startup
- SQLite data should persist outside the container filesystem and should not be mixed into the repository working tree when running under Docker

## Alternatives Considered

### Option 1: Single Dockerfile with multi-target stages

Pros:

- fewer top-level files
- shared base stages

Cons:

- harder to read and maintain for this repository
- less obvious entrypoint behavior when someone inspects the setup later

### Option 2: Compose for development only, manual production runtime

Pros:

- smaller initial change set

Cons:

- weak production story
- duplicates operational knowledge outside version-controlled config

### Recommendation

Use two Dockerfiles plus one compose file. It is the clearest arrangement for this codebase.

## File Boundaries

### New files

- `Dockerfile`
  - production multi-stage build
  - installs dependencies
  - runs `npm run build`
  - runs `npm run start`

- `Dockerfile.dev`
  - development image
  - installs dependencies for iterative local work
  - runs `npm run dev`

- `docker-compose.yml`
  - defines `app-dev` and `app-prod`
  - maps host port `12121`
  - injects `.env`
  - mounts a named volume for SQLite data

- `.dockerignore`
  - excludes `.next`, `node_modules`, logs, and local temporary artifacts from build context

### Modified files

- `lib/db.ts`
  - preserve current behavior outside Docker
  - add a cleaner environment-controlled data directory path for container execution

- `README.md`
  - document Docker development usage
  - document Docker production usage
  - document expected environment variables and volume behavior

## Runtime Design

### Development runtime

The `app-dev` service will:

- build from `Dockerfile.dev`
- mount the repository into `/app`
- keep `node_modules` in a named volume so host files do not override container-installed dependencies
- keep SQLite data in a separate named volume
- run `npm run dev`

Expected result:

- source edits on the host trigger Next.js development reload
- the SQLite file persists across container restarts
- the database file is not written into the repository tree when using Docker

### Production runtime

The `app-prod` service will:

- build from `Dockerfile`
- use a multi-stage image
- run `npm run build` at image build time
- run `npm run start` at container runtime
- mount only the SQLite data volume

Expected result:

- the image can run without source bind mounts
- runtime stays close to a deployable production setup

## Database Path Strategy

The current fallback path uses `process.cwd()/data/mymail.db`. That is acceptable for non-Docker local usage, but the Docker setup should avoid relying on the working directory layout.

The implementation should support:

- `MYMAIL_DB_PATH` as the highest-priority override
- `MYMAIL_DATA_DIR` as the preferred Docker-oriented directory setting
- fallback to the current repository-local `data/mymail.db` path when neither environment variable is set

Resolution order:

1. if `MYMAIL_DB_PATH` is set, use it directly
2. else if `MYMAIL_DATA_DIR` is set, use `<MYMAIL_DATA_DIR>/mymail.db`
3. else if in test mode, use `:memory:`
4. else use the existing local fallback

This is the minimum code change needed to make the Docker setup explicit and portable.

## Environment Variables

The Docker setup should consume the existing root `.env` file through Compose.

Docker-specific additions:

- `MYMAIL_DATA_DIR=/app/data`

Optional existing variables remain unchanged, including:

- `MYMAIL_SECRET`
- OAuth-related credentials already used by the app

## Error Handling and Operational Notes

- If `.env` is missing required secrets, the container may start but provider-specific flows will fail at runtime. This is acceptable and should be documented, not blocked at container boot.
- If the SQLite data volume is empty, the app should initialize the schema automatically through existing `lib/db.ts` behavior.
- If the production image build fails, that should surface during `docker compose build app-prod`, which is the intended verification point.

## Verification Strategy

Implementation verification must cover both development and production paths.

Required checks:

1. local test coverage still passes after the `lib/db.ts` change
2. `docker compose config` resolves successfully
3. `docker compose build app-dev` succeeds
4. `docker compose build app-prod` succeeds
5. `docker compose up app-dev` starts and exposes port `12121`
6. `docker compose up app-prod` starts and exposes port `12121`

If container execution is slow, the minimum completion evidence is successful compose config plus successful image builds, and any runtime limitation must be stated explicitly.

## Out of Scope

- deployment to a cloud provider
- reverse proxy setup
- container healthcheck tuning beyond a simple runnable setup
- migration away from SQLite
- CI pipeline changes
