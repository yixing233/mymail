import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import process from "node:process";

const port = 12121;
const url = `http://127.0.0.1:${port}`;
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const electronCommand = path.join(
  process.cwd(),
  "node_modules",
  ".bin",
  process.platform === "win32" ? "electron.cmd" : "electron",
);

const children = new Set();

function spawnChild(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options,
  });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

function stopChildren() {
  for (const child of children) {
    child.kill();
  }
}

async function waitForServer(targetUrl, attempts = 120) {
  for (let index = 0; index < attempts; index += 1) {
    const ready = await new Promise((resolve) => {
      const request = http.get(targetUrl, (response) => {
        response.resume();
        resolve(response.statusCode && response.statusCode < 500);
      });
      request.on("error", () => resolve(false));
      request.setTimeout(1000, () => {
        request.destroy();
        resolve(false);
      });
    });

    if (ready) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Next dev server did not become ready at ${targetUrl}`);
}

process.once("SIGINT", () => {
  stopChildren();
  process.exit(130);
});
process.once("SIGTERM", () => {
  stopChildren();
  process.exit(143);
});
process.once("exit", stopChildren);

const nextDev = spawnChild(npmCommand, ["run", "dev"], {
  env: {
    ...process.env,
    PORT: String(port),
    MYMAIL_DATA_DIR: process.env.MYMAIL_DATA_DIR || path.join(process.cwd(), "data"),
  },
});

nextDev.once("exit", (code) => {
  if (children.size > 0) {
    stopChildren();
  }
  process.exit(code || 0);
});

await waitForServer(url);

const electron = spawnChild(electronCommand, ["."], {
  env: {
    ...process.env,
    MYMAIL_DESKTOP_URL: url,
    MYMAIL_DATA_DIR: process.env.MYMAIL_DATA_DIR || path.join(process.cwd(), "data"),
  },
});

electron.once("exit", (code) => {
  stopChildren();
  process.exit(code || 0);
});
