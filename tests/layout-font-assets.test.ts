import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("root layout font assets", () => {
  it("does not depend on the external Font Awesome CDN stylesheet", () => {
    const layoutPath = path.join(process.cwd(), "app", "layout.tsx");
    const layoutSource = readFileSync(layoutPath, "utf8");

    expect(layoutSource).not.toContain("cdnjs.cloudflare.com/ajax/libs/font-awesome");
  });
});
