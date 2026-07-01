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
    expect(content).toContain('- "${MYMAIL_DEV_PORT:-12121}:12121"');
    expect(content).toContain('- "${MYMAIL_PROD_PORT:-12121}:12121"');
  });
});
