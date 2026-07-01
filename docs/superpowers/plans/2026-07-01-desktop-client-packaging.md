# Desktop Client Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working Windows desktop client for MyMail and make `npm run desktop:pack` reliably generate a launchable packaged app.

**Architecture:** Wrap the existing Next.js app with Electron instead of static export, because MyMail depends on API routes, SQLite, IMAP, OAuth callbacks, and server-side filesystem access. In development, Electron waits for `next dev`; in packaged mode, the Electron main process starts the bundled Next server on a local loopback port and opens a BrowserWindow against it.

**Tech Stack:** Next.js 16, React 19, Electron 35, electron-builder, better-sqlite3, Vitest, TypeScript, Node.js scripts.

---

## File Structure

- Create: `desktop/main.js`
  - Electron main process. Owns the app window lifecycle, starts production Next server, selects a local port, and shuts the server down when Electron exits.
- Create: `desktop/preload.js`
  - Preload bridge. Exposes a small read-only desktop environment object to the renderer.
- Create: `scripts/desktop-dev.mjs`
  - Development runner. Starts `npm run dev`, waits for the local Next server, then launches Electron.
- Create: `scripts/desktop-pack.mjs`
  - Packaging runner. Runs `npm run build`, runs `electron-builder`, then rebuilds native dependencies back for the normal Node runtime.
- Create: `electron-builder.yml`
  - Windows packaging configuration. Includes Next build output, runtime files, Electron files, and native dependencies.
- Modify: `package.json`
  - Add Electron entry point, desktop scripts, and dev dependencies.
- Modify: `.gitignore`
  - Ignore packaged desktop output.
- Modify: `README.md`
  - Document development, packaging, and generated executable location.
- Create: `tests/desktop-app.test.ts`
  - Regression coverage for desktop entry files, scripts, builder config, and native dependency recovery behavior.

---

### Task 1: Prepare The Desktop Branch

**Files:**
- Modify: none

- [ ] **Step 1: Confirm the working branch**

Run:

```powershell
git branch --show-current
git status -sb
```

Expected:

```text
desktop
## desktop...origin/desktop
```

- [ ] **Step 2: Create the branch if it does not exist**

Run only if Step 1 is not on `desktop`:

```powershell
git fetch origin
git checkout -B desktop origin/web
```

Expected:

```text
Switched to a new branch 'desktop'
```

- [ ] **Step 3: Commit branch preparation if any tracked file changed**

Run:

```powershell
git status -sb
```

Expected: no tracked file changes from this task. Do not commit generated directories such as `.next/`, `dist-desktop/`, `data/`, or `.env`.

---

### Task 2: Add Desktop Dependencies And Scripts

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Install Electron packaging dependencies**

Run:

```powershell
npm install --save-dev electron@35 electron-builder
```

Expected: `package.json` contains dev dependencies named `electron` and `electron-builder`.

- [ ] **Step 2: Update `package.json` scripts and main entry**

Edit `package.json` so these keys exist:

```json
{
  "main": "desktop/main.js",
  "scripts": {
    "dev": "next dev -p 12121",
    "build": "next build",
    "start": "next start -p 12121",
    "desktop:dev": "node scripts/desktop-dev.mjs",
    "desktop:start": "electron .",
    "desktop:pack": "node scripts/desktop-pack.mjs --dir",
    "desktop:build": "node scripts/desktop-pack.mjs",
    "test": "vitest run"
  }
}
```

Keep existing unrelated scripts if the repository has them.

- [ ] **Step 3: Verify dependency installation**

Run:

```powershell
npm install
npm test -- tests/desktop-app.test.ts
```

Expected before Task 7: the targeted test command may fail because `tests/desktop-app.test.ts` does not exist yet. Dependency installation itself must succeed.

- [ ] **Step 4: Commit**

Run:

```powershell
git add package.json package-lock.json
git commit -m "Add Electron desktop dependencies"
```

Expected: one commit containing only dependency and script metadata.

---

### Task 3: Add The Electron Main Process

**Files:**
- Create: `desktop/main.js`
- Create: `desktop/preload.js`

- [ ] **Step 1: Create `desktop/main.js`**

Add this file:

```javascript
const { app, BrowserWindow, shell } = require("electron");
const http = require("http");
const path = require("path");
const { pathToFileURL } = require("url");
const next = require("next");

const devServerUrl = process.env.MYMAIL_DESKTOP_DEV_URL || "http://127.0.0.1:12121";
let server;
let serverUrl;

function getAppRoot() {
  return app.isPackaged ? process.resourcesPath : path.join(__dirname, "..");
}

function listen(serverInstance, port) {
  return new Promise((resolve, reject) => {
    serverInstance.once("error", reject);
    serverInstance.listen(port, "127.0.0.1", () => {
      serverInstance.off("error", reject);
      const address = serverInstance.address();
      const resolvedPort = typeof address === "object" && address ? address.port : port;
      resolve(`http://127.0.0.1:${resolvedPort}`);
    });
  });
}

async function startNextServer() {
  if (!app.isPackaged) {
    return devServerUrl;
  }

  const appRoot = getAppRoot();
  const nextApp = next({ dev: false, dir: appRoot, hostname: "127.0.0.1", port: 0 });
  const handler = nextApp.getRequestHandler();
  await nextApp.prepare();

  server = http.createServer((request, response) => {
    handler(request, response);
  });
  serverUrl = await listen(server, 0);
  return serverUrl;
}

async function createWindow() {
  const url = await startNextServer();
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: "MyMail",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.once("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    shell.openExternal(targetUrl);
    return { action: "deny" };
  });

  await win.loadURL(url);
}

app.whenReady().then(createWindow);

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (server) {
    server.close();
    server = undefined;
  }
});

module.exports = {
  getAppRoot,
  listen
};
```

- [ ] **Step 2: Create `desktop/preload.js`**

Add this file:

```javascript
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("mymailDesktop", {
  platform: process.platform,
  packaged: process.defaultApp !== true
});
```

- [ ] **Step 3: Verify Electron files are syntactically valid**

Run:

```powershell
node -c desktop/main.js
node -c desktop/preload.js
```

Expected: both commands exit with code `0` and print no syntax errors.

- [ ] **Step 4: Commit**

Run:

```powershell
git add desktop/main.js desktop/preload.js
git commit -m "Add Electron desktop shell"
```

Expected: one commit containing only `desktop/` files.

---

### Task 4: Add Desktop Development Runner

**Files:**
- Create: `scripts/desktop-dev.mjs`

- [ ] **Step 1: Create `scripts/desktop-dev.mjs`**

Add this file:

```javascript
import { spawn } from "node:child_process";
import process from "node:process";

const url = process.env.MYMAIL_DESKTOP_DEV_URL || "http://127.0.0.1:12121";
const isWindows = process.platform === "win32";
const npmCommand = isWindows ? "npm.cmd" : "npm";
const electronCommand = isWindows ? "npx.cmd" : "npx";

function run(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: false,
    ...options
  });
  return child;
}

async function waitForServer(targetUrl, timeoutMs = 60000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(targetUrl);
      if (response.status < 500) {
        return;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`Timed out waiting for ${targetUrl}`);
}

const nextProcess = run(npmCommand, ["run", "dev"]);

try {
  await waitForServer(url);
  const electronProcess = run(electronCommand, ["electron", "."], {
    env: {
      ...process.env,
      MYMAIL_DESKTOP_DEV_URL: url
    }
  });

  electronProcess.on("exit", (code) => {
    nextProcess.kill();
    process.exit(code ?? 0);
  });
} catch (error) {
  nextProcess.kill();
  console.error(error);
  process.exit(1);
}
```

- [ ] **Step 2: Verify the runner parses**

Run:

```powershell
node --check scripts/desktop-dev.mjs
```

Expected: exit code `0`.

- [ ] **Step 3: Manually launch development desktop app**

Run:

```powershell
npm run desktop:dev
```

Expected: a desktop window opens and loads MyMail from `http://127.0.0.1:12121`. Close the window after smoke testing.

- [ ] **Step 4: Commit**

Run:

```powershell
git add scripts/desktop-dev.mjs package.json
git commit -m "Add desktop development runner"
```

Expected: one commit containing the dev runner and script metadata.

---

### Task 5: Add Electron Builder Configuration

**Files:**
- Create: `electron-builder.yml`
- Modify: `.gitignore`

- [ ] **Step 1: Create `electron-builder.yml`**

Add this file:

```yaml
appId: com.mymail.desktop
productName: MyMail
directories:
  output: dist-desktop
asar: false
files:
  - app/**/*
  - components/**/*
  - desktop/**/*
  - lib/**/*
  - scripts/**/*
  - .next/**/*
  - next.config.ts
  - next-env.d.ts
  - package.json
  - package-lock.json
  - postcss.config.mjs
  - tsconfig.json
  - mymail-icon.png
  - node_modules/**/*
  - "!dist-desktop/**/*"
  - "!.next/cache/**/*"
  - "!.next/dev/**/*"
  - "!.next/node_modules/**/*"
  - "!data/**/*"
  - "!docs/**/*"
  - "!tests/**/*"
  - "!*.log"
win:
  target:
    - target: dir
      arch:
        - x64
  icon: mymail-icon.png
npmRebuild: true
```

- [ ] **Step 2: Ignore desktop build output**

Ensure `.gitignore` contains:

```gitignore
dist-desktop/
```

- [ ] **Step 3: Validate builder config is present**

Run:

```powershell
Test-Path electron-builder.yml
Select-String -Path .gitignore -Pattern "dist-desktop/"
```

Expected:

```text
True
dist-desktop/
```

- [ ] **Step 4: Commit**

Run:

```powershell
git add electron-builder.yml .gitignore
git commit -m "Configure Electron desktop packaging"
```

Expected: one commit containing packaging config and ignore rule.

---

### Task 6: Add Packaging Runner With Native Dependency Recovery

**Files:**
- Create: `scripts/desktop-pack.mjs`
- Modify: `package.json`

- [ ] **Step 1: Create `scripts/desktop-pack.mjs`**

Add this file:

```javascript
import { spawn } from "node:child_process";
import process from "node:process";

const isWindows = process.platform === "win32";
const npmCommand = isWindows ? "npm.cmd" : "npm";
const npxCommand = isWindows ? "npx.cmd" : "npx";
const builderArgs = ["electron-builder", ...process.argv.slice(2)];

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: false
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
      }
    });
    child.on("error", reject);
  });
}

try {
  await run(npmCommand, ["run", "build"]);
  await run(npxCommand, builderArgs);
} finally {
  await run(npmCommand, ["rebuild", "better-sqlite3"]);
  console.log("rebuilt dependencies successfully");
}
```

- [ ] **Step 2: Ensure package scripts call the runner**

Confirm `package.json` contains:

```json
{
  "scripts": {
    "desktop:pack": "node scripts/desktop-pack.mjs --dir",
    "desktop:build": "node scripts/desktop-pack.mjs"
  }
}
```

- [ ] **Step 3: Verify the runner parses**

Run:

```powershell
node --check scripts/desktop-pack.mjs
```

Expected: exit code `0`.

- [ ] **Step 4: Commit**

Run:

```powershell
git add scripts/desktop-pack.mjs package.json
git commit -m "Add desktop packaging runner"
```

Expected: one commit containing the pack runner and scripts.

---

### Task 7: Add Desktop Packaging Regression Tests

**Files:**
- Create: `tests/desktop-app.test.ts`

- [ ] **Step 1: Create `tests/desktop-app.test.ts`**

Add this file:

```typescript
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(filePath: string) {
  return fs.readFileSync(path.join(root, filePath), "utf8");
}

describe("desktop app packaging", () => {
  it("has an Electron main entry and preload file", () => {
    const packageJson = JSON.parse(read("package.json")) as { main?: string; scripts?: Record<string, string> };

    expect(packageJson.main).toBe("desktop/main.js");
    expect(fs.existsSync(path.join(root, "desktop/main.js"))).toBe(true);
    expect(fs.existsSync(path.join(root, "desktop/preload.js"))).toBe(true);
    expect(read("desktop/main.js")).toContain("BrowserWindow");
    expect(read("desktop/main.js")).toContain("next({ dev: false");
    expect(read("desktop/preload.js")).toContain("contextBridge.exposeInMainWorld");
  });

  it("defines desktop development and packaging scripts", () => {
    const packageJson = JSON.parse(read("package.json")) as { scripts: Record<string, string> };

    expect(packageJson.scripts["desktop:dev"]).toBe("node scripts/desktop-dev.mjs");
    expect(packageJson.scripts["desktop:pack"]).toBe("node scripts/desktop-pack.mjs --dir");
    expect(packageJson.scripts["desktop:build"]).toBe("node scripts/desktop-pack.mjs");
  });

  it("configures electron-builder output and required runtime files", () => {
    const config = read("electron-builder.yml");

    expect(config).toContain("output: dist-desktop");
    expect(config).toContain("desktop/**/*");
    expect(config).toContain(".next/**/*");
    expect(config).toContain("node_modules/**/*");
    expect(config).toContain("!.next/cache/**/*");
    expect(config).toContain("target: dir");
  });

  it("ignores packaged desktop artifacts", () => {
    expect(read(".gitignore")).toContain("dist-desktop/");
  });

  it("rebuilds better-sqlite3 after electron-builder runs", () => {
    const script = read("scripts/desktop-pack.mjs");

    expect(script).toContain("electron-builder");
    expect(script).toContain("rebuild");
    expect(script).toContain("better-sqlite3");
    expect(script).toContain("finally");
  });
});
```

- [ ] **Step 2: Run the new test**

Run:

```powershell
npm test -- tests/desktop-app.test.ts
```

Expected:

```text
Test Files  1 passed
Tests  5 passed
```

- [ ] **Step 3: Commit**

Run:

```powershell
git add tests/desktop-app.test.ts
git commit -m "Test desktop packaging setup"
```

Expected: one commit containing only the desktop packaging regression test.

---

### Task 8: Document Desktop Usage

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add README desktop section**

Add this section to `README.md`:

````markdown
## Desktop Client

The desktop client is an Electron wrapper around the existing Next.js app. This keeps API routes, SQLite storage, IMAP sync, and OAuth flows available inside the packaged app.

### Development

```bash
npm run desktop:dev
```

This starts `next dev` on `127.0.0.1:12121` and opens the Electron window after the server is ready.

### Package Windows Directory Build

```bash
npm run desktop:pack
```

The unpacked Windows executable is generated at:

```text
dist-desktop/win-unpacked/MyMail.exe
```

### Package Installer Build

```bash
npm run desktop:build
```

The packaging script rebuilds `better-sqlite3` back for the normal Node runtime after Electron packaging finishes.
````

- [ ] **Step 2: Verify README includes command names**

Run:

```powershell
Select-String -Path README.md -Pattern "desktop:dev","desktop:pack","MyMail.exe"
```

Expected: all three patterns are found.

- [ ] **Step 3: Commit**

Run:

```powershell
git add README.md
git commit -m "Document desktop client packaging"
```

Expected: one commit containing only README changes.

---

### Task 9: Full Verification

**Files:**
- Modify: none

- [ ] **Step 1: Run TypeScript verification**

Run:

```powershell
npx tsc --noEmit --pretty false
```

Expected: exit code `0`.

- [ ] **Step 2: Run full test suite**

Run:

```powershell
npm test
```

Expected:

```text
Test Files  21 passed
Tests  96 passed
```

The exact test count can be higher if additional tests were added. No test may fail.

- [ ] **Step 3: Run web production build**

Run:

```powershell
npm run build
```

Expected:

```text
Compiled successfully
```

A Turbopack NFT tracing warning from `next.config.ts` through `lib/chrome.ts` is acceptable only if the build exits successfully.

- [ ] **Step 4: Run desktop directory packaging**

Run:

```powershell
npm run desktop:pack
```

Expected:

```text
packaging       platform=win32 arch=x64 electron=35.7.5 appOutDir=dist-desktop\win-unpacked
rebuilt dependencies successfully
```

- [ ] **Step 5: Confirm executable exists**

Run:

```powershell
Test-Path dist-desktop/win-unpacked/MyMail.exe
```

Expected:

```text
True
```

- [ ] **Step 6: Confirm source tree has no generated tracked changes**

Run:

```powershell
git status -sb
```

Expected: only intentional tracked files are modified. Do not commit `.next/`, `dist-desktop/`, `data/`, or `.env`. If `next-env.d.ts` changed only between `.next/dev/types/routes.d.ts` and `.next/types/routes.d.ts`, restore it before committing.

---

### Task 10: Push Desktop Branch

**Files:**
- Modify: none

- [ ] **Step 1: Review final commit history**

Run:

```powershell
git log --oneline --decorate -8
```

Expected: desktop packaging commits are present on `desktop`.

- [ ] **Step 2: Push branch**

Run:

```powershell
git push origin desktop
```

Expected:

```text
desktop -> desktop
```

- [ ] **Step 3: Confirm remote branch points at local HEAD**

Run:

```powershell
git rev-parse HEAD
git ls-remote origin refs/heads/desktop
```

Expected: both commands show the same commit hash.

---

## Release Acceptance Checklist

- [ ] `npm test` passes.
- [ ] `npx tsc --noEmit --pretty false` passes.
- [ ] `npm run build` passes.
- [ ] `npm run desktop:pack` passes.
- [ ] `dist-desktop/win-unpacked/MyMail.exe` exists.
- [ ] Launching `MyMail.exe` opens the MyMail UI.
- [ ] The app can read/write its SQLite database outside the repository when packaged.
- [ ] Outlook/Gmail/IMAP sync routes still work in the desktop window.
- [ ] No generated build output is committed.
- [ ] `desktop` branch is pushed to `origin`.
