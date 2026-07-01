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
    expect(content).toContain('CMD ["npm", "run", "dev"]');
  });
});
