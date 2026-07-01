import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("README Docker documentation", () => {
  it("documents development and production compose workflows", () => {
    const readmePath = path.join(process.cwd(), "README.md");
    const content = fs.readFileSync(readmePath, "utf8");

    expect(content).toContain("## Docker");
    expect(content).toContain("docker compose up --build app-dev");
    expect(content).toContain("docker compose up --build app-prod");
    expect(content).toContain("MYMAIL_DATA_DIR");
    expect(content).toContain("MYMAIL_DEV_PORT");
    expect(content).toContain("MYMAIL_PROD_PORT");
  });
});
