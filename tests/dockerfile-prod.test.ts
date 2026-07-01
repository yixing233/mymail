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
    expect(content).toContain('CMD ["npm", "run", "start"]');
  });
});
