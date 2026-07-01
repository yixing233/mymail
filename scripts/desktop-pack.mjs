import { spawn } from "node:child_process";
import fs from "node:fs";
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

async function rebuildElectronNativeDeps() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
  const electronVersion = String(packageJson.devDependencies?.electron || "").replace(/^[^\d]*/, "");
  if (!electronVersion) {
    throw new Error("Unable to determine Electron version from package.json");
  }

  await run(npmCommand, [
    "rebuild",
    "better-sqlite3",
    "--runtime=electron",
    `--target=${electronVersion}`,
    "--disturl=https://electronjs.org/headers",
  ]);
}

function materializeNextExternalAliases() {
  const aliasRoot = path.join(process.cwd(), ".next", "node_modules");
  if (!fs.existsSync(aliasRoot)) {
    return;
  }

  for (const aliasName of fs.readdirSync(aliasRoot)) {
    const aliasPath = path.join(aliasRoot, aliasName);
    const stat = fs.lstatSync(aliasPath);
    if (!stat.isSymbolicLink() && !stat.isDirectory()) {
      continue;
    }

    const targetPath = fs.realpathSync(aliasPath);
    if (path.resolve(targetPath) === path.resolve(aliasPath)) {
      continue;
    }

    const targetPackagePath = path.join(targetPath, "package.json");
    if (!fs.existsSync(targetPackagePath)) {
      continue;
    }

    const targetPackage = JSON.parse(fs.readFileSync(targetPackagePath, "utf8"));
    const targetName = targetPackage.name;
    if (typeof targetName !== "string" || !targetName) {
      continue;
    }

    fs.rmSync(aliasPath, { recursive: true, force: true });
    fs.mkdirSync(aliasPath, { recursive: true });
    fs.writeFileSync(
      path.join(aliasPath, "package.json"),
      JSON.stringify({ name: aliasName, main: "index.js" }, null, 2),
    );
    fs.writeFileSync(
      path.join(aliasPath, "index.js"),
      `module.exports = require(${JSON.stringify(targetName)});\n`,
    );
  }
}

let originalError = null;

try {
  await run(npmCommand, ["run", "build"]);
  materializeNextExternalAliases();
  await rebuildElectronNativeDeps();
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
