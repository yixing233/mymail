import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const builderCommand = path.join(
  process.cwd(),
  "node_modules",
  ".bin",
  process.platform === "win32" ? "electron-builder.cmd" : "electron-builder",
);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
    child.once("error", reject);
  });
}

async function restoreNodeNativeDeps() {
  await run(npmCommand, ["rebuild", "better-sqlite3"]);
}

let originalError = null;

try {
  await run(npmCommand, ["run", "build"]);
  const builderArgs = ["--config", "electron-builder.yml"];
  if (process.argv.includes("--dir")) {
    builderArgs.unshift("--dir");
  }
  await run(builderCommand, builderArgs);
} catch (error) {
  originalError = error;
} finally {
  try {
    await restoreNodeNativeDeps();
  } catch (restoreError) {
    if (!originalError) {
      originalError = restoreError;
    } else {
      console.error(restoreError);
    }
  }
}

if (originalError) {
  throw originalError;
}
