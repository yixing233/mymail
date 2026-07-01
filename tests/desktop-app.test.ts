import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function readJson(file: string) {
  return JSON.parse(fs.readFileSync(path.join(root, file), "utf8")) as Record<string, any>;
}

function readText(file: string) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

describe("desktop app packaging", () => {
  it("declares Electron entry points and desktop scripts", () => {
    const pkg = readJson("package.json");

    expect(pkg.main).toBe("desktop/main.js");
    expect(pkg.scripts["desktop:dev"]).toBe("node scripts/desktop-dev.mjs");
    expect(pkg.scripts["desktop:start"]).toBe("electron .");
    expect(pkg.scripts["desktop:pack"]).toBe("node scripts/desktop-pack.mjs --dir");
    expect(pkg.scripts["desktop:build"]).toBe("node scripts/desktop-pack.mjs");
    expect(pkg.devDependencies.electron).toBeTruthy();
    expect(pkg.devDependencies["electron-builder"]).toBeTruthy();
  });

  it("boots the existing Next app inside an Electron window", () => {
    const main = readText("desktop/main.js");

    expect(main).toContain("BrowserWindow");
    expect(main).toContain("require(\"next\")");
    expect(main).toContain("MYMAIL_DESKTOP_URL");
    expect(main).toContain("startNextServer");
    expect(main).toContain("preload.js");
  });

  it("provides a dev launcher that runs Next and Electron together", () => {
    const launcher = readText("scripts/desktop-dev.mjs");

    expect(launcher).toContain("npm");
    expect(launcher).toContain("run");
    expect(launcher).toContain("dev");
    expect(launcher).toContain("MYMAIL_DESKTOP_URL");
    expect(launcher).toContain("electron");
  });

  it("restores native Node dependencies after desktop packaging", () => {
    const packer = readText("scripts/desktop-pack.mjs");

    expect(packer).toContain("electron-builder");
    expect(packer).toContain("rebuild");
    expect(packer).toContain("better-sqlite3");
  });

  it("configures Electron Builder for a Windows desktop artifact", () => {
    const config = readText("electron-builder.yml");

    expect(config).toContain("appId: com.mymail.desktop");
    expect(config).toContain("productName: MyMail");
    expect(config).toContain("dist-desktop");
    expect(config).toContain("desktop/**/*");
    expect(config).toContain(".next/**/*");
    expect(config).toContain("target: nsis");
  });
});
