import { describe, expect, it } from "vitest";
import { mailFrameSandbox, mailFrameScrolling } from "@/components/mail-detail";

describe("mail detail frame scrolling", () => {
  it("lets the parent measure iframe height and disables iframe nested scrolling", () => {
    expect(mailFrameSandbox).toContain("allow-same-origin");
    expect(mailFrameSandbox).not.toContain("allow-scripts");
    expect(mailFrameScrolling).toBe("no");
  });
});
