# Docker Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Docker-based development and production runtime for the MyMail project, with separate development and production images and persistent SQLite storage outside the source tree.

**Architecture:** Use `Dockerfile.dev` for bind-mounted development, `Dockerfile` for multi-stage production builds, and `docker-compose.yml` to define both workflows. Update the database path resolution to prefer `MYMAIL_DB_PATH`, then `MYMAIL_DATA_DIR`, while preserving the existing non-Docker local fallback.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, SQLite (`better-sqlite3`), Docker, Docker Compose

---

### Task 1: Add database path coverage for Docker-aware storage

**Files:**
- Create: `E:\Code\mymail\tests\db-path.test.ts`
- Modify: `E:\Code\mymail\lib\db.ts`
- Test: `E:\Code\mymail\tests\db-path.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

function resetDbModule() {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.MYMAIL_DB_PATH;
  delete process.env.MYMAIL_DATA_DIR;
  delete process.env.VITEST;
  delete process.env.NODE_ENV;
}

async function loadDbModule() {
  return import("@/lib/db");
}

describe("database path resolution", () => {
  afterEach(() => {
    resetDbModule();
  });

  it("prefers MYMAIL_DB_PATH when provided", async () => {
    process.env.MYMAIL_DB_PATH = "/tmp/custom/location.sqlite";
    const { resolveDbPath } = await loadDbModule();

    expect(resolveDbPath()).toBe("/tmp/custom/location.sqlite");
  });

  it("uses MYMAIL_DATA_DIR when MYMAIL_DB_PATH is absent", async () => {
    process.env.MYMAIL_DATA_DIR = "/var/lib/mymail";
    const { resolveDbPath } = await loadDbModule();

    expect(resolveDbPath()).toBe(path.join("/var/lib/mymail", "mymail.db"));
  });

  it("uses in-memory storage in test mode when no explicit path is configured", async () => {
    process.env.NODE_ENV = "test";
    const { resolveDbPath } = await loadDbModule();

    expect(resolveDbPath()).toBe(":memory:");
  });

  it("falls back to the repository data directory outside test mode", async () => {
    process.env.NODE_ENV = "development";
    const { resolveDbPath } = await loadDbModule();

    expect(resolveDbPath()).toBe(path.join(process.cwd(), "data", "mymail.db"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/db-path.test.ts`
Expected: FAIL because `resolveDbPath` is not exported from `lib/db.ts`

- [ ] **Step 3: Write minimal implementation**

```typescript
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

let dbInstance: Database.Database | null = null;

export function resolveDbPath() {
  if (process.env.MYMAIL_DB_PATH) {
    return process.env.MYMAIL_DB_PATH;
  }

  if (process.env.MYMAIL_DATA_DIR) {
    return path.join(process.env.MYMAIL_DATA_DIR, "mymail.db");
  }

  if (process.env.NODE_ENV === "test" || process.env.VITEST) {
    return ":memory:";
  }

  return path.join(process.cwd(), "data", "mymail.db");
}

export function getDb() {
  if (dbInstance) return dbInstance;

  const dbPath = resolveDbPath();

  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  // keep the existing schema and migration logic unchanged below this point
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/db-path.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full unit test suite**

Run: `npm test`
Expected: PASS with no new failures

- [ ] **Step 6: Commit**

```bash
git add tests/db-path.test.ts lib/db.ts
git commit -m "test: cover docker-aware database path resolution"
```

If `git` is unavailable because this directory is not a repository, skip the commit and continue.

### Task 2: Add Docker build context files

**Files:**
- Create: `E:\Code\mymail\.dockerignore`
- Test: `E:\Code\mymail\.dockerignore`

- [ ] **Step 1: Write the failing test**

```typescript
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe(".dockerignore", () => {
  it("excludes local build and dependency artifacts from the Docker build context", () => {
    const dockerignorePath = path.join(process.cwd(), ".dockerignore");
    const content = fs.readFileSync(dockerignorePath, "utf8");

    expect(content).toContain("node_modules");
    expect(content).toContain(".next");
    expect(content).toContain("next-start.out.log");
    expect(content).toContain("next-start.err.log");
    expect(content).toContain(".codex_tmp");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/dockerignore.test.ts`
Expected: FAIL because `.dockerignore` and the test file do not exist yet

- [ ] **Step 3: Write minimal implementation**

Create `tests/dockerignore.test.ts` with the code from Step 1.

Create `.dockerignore` with:

```text
node_modules
.next
.codex_tmp
build.log
build-check.log
notification-build.log
next-start.out.log
next-start.err.log
npm-debug.log
data/*.db
data/*.db-shm
data/*.db-wal
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/dockerignore.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/dockerignore.test.ts .dockerignore
git commit -m "build: add docker build context exclusions"
```

If `git` is unavailable because this directory is not a repository, skip the commit and continue.

### Task 3: Add the dedicated development Docker image

**Files:**
- Create: `E:\Code\mymail\Dockerfile.dev`
- Create: `E:\Code\mymail\tests\dockerfile-dev.test.ts`
- Test: `E:\Code\mymail\tests\dockerfile-dev.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Dockerfile.dev", () => {
  it("installs dependencies and starts the Next.js development server on port 12121", () => {
    const dockerfilePath = path.join(process.cwd(), "Dockerfile.dev");
    const content = fs.readFileSync(dockerfilePath, "utf8");

    expect(content).toContain("FROM node:");
    expect(content).toContain("WORKDIR /app");
    expect(content).toContain("COPY package.json package-lock.json ./");
    expect(content).toContain("npm ci");
    expect(content).toContain("EXPOSE 12121");
    expect(content).toContain("CMD [\"npm\", \"run\", \"dev\"]");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/dockerfile-dev.test.ts`
Expected: FAIL because `Dockerfile.dev` and the test file do not exist yet

- [ ] **Step 3: Write minimal implementation**

Create `tests/dockerfile-dev.test.ts` with the code from Step 1.

Create `Dockerfile.dev` with:

```dockerfile
FROM node:20-bookworm

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 12121

CMD ["npm", "run", "dev"]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/dockerfile-dev.test.ts`
Expected: PASS

- [ ] **Step 5: Build the development image**

Run: `docker build -f Dockerfile.dev -t mymail-dev .`
Expected: SUCCESS

- [ ] **Step 6: Commit**

```bash
git add tests/dockerfile-dev.test.ts Dockerfile.dev
git commit -m "build: add development docker image"
```

If `git` is unavailable because this directory is not a repository, skip the commit and continue.

### Task 4: Add the production Docker image

**Files:**
- Create: `E:\Code\mymail\Dockerfile`
- Create: `E:\Code\mymail\tests\dockerfile-prod.test.ts`
- Test: `E:\Code\mymail\tests\dockerfile-prod.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Dockerfile", () => {
  it("uses a multi-stage build and starts the production server on port 12121", () => {
    const dockerfilePath = path.join(process.cwd(), "Dockerfile");
    const content = fs.readFileSync(dockerfilePath, "utf8");

    expect(content).toContain("AS deps");
    expect(content).toContain("AS builder");
    expect(content).toContain("AS runner");
    expect(content).toContain("npm run build");
    expect(content).toContain("EXPOSE 12121");
    expect(content).toContain("CMD [\"npm\", \"run\", \"start\"]");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/dockerfile-prod.test.ts`
Expected: FAIL because `Dockerfile` and the test file do not exist yet

- [ ] **Step 3: Write minimal implementation**

Create `tests/dockerfile-prod.test.ts` with the code from Step 1.

Create `Dockerfile` with:

```dockerfile
FROM node:20-bookworm AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-bookworm AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-bookworm AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/app ./app

EXPOSE 12121

CMD ["npm", "run", "start"]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/dockerfile-prod.test.ts`
Expected: PASS

- [ ] **Step 5: Build the production image**

Run: `docker build -f Dockerfile -t mymail-prod .`
Expected: SUCCESS

- [ ] **Step 6: Commit**

```bash
git add tests/dockerfile-prod.test.ts Dockerfile
git commit -m "build: add production docker image"
```

If `git` is unavailable because this directory is not a repository, skip the commit and continue.

### Task 5: Add compose orchestration for development and production

**Files:**
- Create: `E:\Code\mymail\docker-compose.yml`
- Create: `E:\Code\mymail\tests\docker-compose.test.ts`
- Test: `E:\Code\mymail\tests\docker-compose.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("docker-compose.yml", () => {
  it("defines development and production services with a shared data volume", () => {
    const composePath = path.join(process.cwd(), "docker-compose.yml");
    const content = fs.readFileSync(composePath, "utf8");

    expect(content).toContain("app-dev:");
    expect(content).toContain("app-prod:");
    expect(content).toContain("MYMAIL_DATA_DIR: /app/data");
    expect(content).toContain("- mymail-data:/app/data");
    expect(content).toContain("- 12121:12121");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/docker-compose.test.ts`
Expected: FAIL because `docker-compose.yml` and the test file do not exist yet

- [ ] **Step 3: Write minimal implementation**

Create `tests/docker-compose.test.ts` with the code from Step 1.

Create `docker-compose.yml` with:

```yaml
services:
  app-dev:
    build:
      context: .
      dockerfile: Dockerfile.dev
    env_file:
      - .env
    environment:
      MYMAIL_DATA_DIR: /app/data
    ports:
      - "12121:12121"
    volumes:
      - .:/app
      - mymail-node-modules:/app/node_modules
      - mymail-data:/app/data

  app-prod:
    build:
      context: .
      dockerfile: Dockerfile
    env_file:
      - .env
    environment:
      NODE_ENV: production
      MYMAIL_DATA_DIR: /app/data
    ports:
      - "12121:12121"
    volumes:
      - mymail-data:/app/data

volumes:
  mymail-node-modules:
  mymail-data:
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/docker-compose.test.ts`
Expected: PASS

- [ ] **Step 5: Validate compose syntax**

Run: `docker compose config`
Expected: SUCCESS with rendered services and volumes

- [ ] **Step 6: Commit**

```bash
git add tests/docker-compose.test.ts docker-compose.yml
git commit -m "build: add docker compose runtime"
```

If `git` is unavailable because this directory is not a repository, skip the commit and continue.

### Task 6: Document Docker usage for developers and operators

**Files:**
- Modify: `E:\Code\mymail\README.md`
- Create: `E:\Code\mymail\tests\readme-docker.test.ts`
- Test: `E:\Code\mymail\tests\readme-docker.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("README Docker documentation", () => {
  it("documents development and production compose workflows", () => {
    const readmePath = path.join(process.cwd(), "README.md");
    const content = fs.readFileSync(readmePath, "utf8");

    expect(content).toContain("## Docker");
    expect(content).toContain("docker compose up app-dev");
    expect(content).toContain("docker compose up app-prod");
    expect(content).toContain("MYMAIL_DATA_DIR");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/readme-docker.test.ts`
Expected: FAIL because the README does not yet document Docker usage

- [ ] **Step 3: Write minimal implementation**

Create `tests/readme-docker.test.ts` with the code from Step 1.

Update `README.md` to add a `## Docker` section that includes:

```markdown
## Docker

### Development

```bash
docker compose up --build app-dev
```

Open `http://localhost:12121`.

### Production-style runtime

```bash
docker compose up --build app-prod
```

### Notes

- Compose reads environment variables from `.env`
- Docker sets `MYMAIL_DATA_DIR=/app/data`
- SQLite data is stored in the `mymail-data` Docker volume
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/readme-docker.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/readme-docker.test.ts README.md
git commit -m "docs: document docker workflows"
```

If `git` is unavailable because this directory is not a repository, skip the commit and continue.

### Task 7: End-to-end verification of Docker workflows

**Files:**
- Verify only

- [ ] **Step 1: Run the full unit test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 2: Build the development container path through Compose**

Run: `docker compose build app-dev`
Expected: SUCCESS

- [ ] **Step 3: Build the production container path through Compose**

Run: `docker compose build app-prod`
Expected: SUCCESS

- [ ] **Step 4: Start the development service**

Run: `docker compose up -d app-dev`
Expected: SUCCESS

- [ ] **Step 5: Verify the development service responds**

Run: `docker compose ps`
Expected: `app-dev` shows a running state and port mapping for `12121`

- [ ] **Step 6: Stop the development service**

Run: `docker compose down`
Expected: SUCCESS

- [ ] **Step 7: Start the production service**

Run: `docker compose up -d app-prod`
Expected: SUCCESS

- [ ] **Step 8: Verify the production service responds**

Run: `docker compose ps`
Expected: `app-prod` shows a running state and port mapping for `12121`

- [ ] **Step 9: Stop the production service**

Run: `docker compose down`
Expected: SUCCESS

- [ ] **Step 10: Commit**

```bash
git add .
git commit -m "feat: add docker development and production runtime"
```

If `git` is unavailable because this directory is not a repository, skip the commit and continue.
