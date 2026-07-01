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
