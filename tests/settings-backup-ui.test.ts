import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("settings backup ui", () => {
  it("adds a backup and restore section to the settings dialog", () => {
    const content = readFileSync(path.join(process.cwd(), "components", "providers-panel.tsx"), "utf8");
    expect(content).toContain("备份与恢复");
    expect(content).toContain("导出备份");
    expect(content).toContain("导入并覆盖");
    expect(content).toContain("导入并合并");
  });
});
