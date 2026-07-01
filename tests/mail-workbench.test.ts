import { describe, expect, it, vi } from "vitest";
import {
  getHydratingMessageIdAfterHydration,
  needsMessageHydration,
  shouldShowDetailLoading,
} from "@/components/mail-workbench";
import type { MailDetail } from "@/lib/types";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function buildMailDetail(overrides: Partial<MailDetail>): MailDetail {
  return {
    id: "message-1",
    providerId: "qq",
    mailboxId: "qq-box",
    providerLabel: "QQ Mail",
    from: "sender@example.com",
    subject: "Subject",
    preview: "Preview",
    receivedAt: "2026-06-05T00:00:00.000Z",
    unread: true,
    hasAttachments: false,
    tags: [],
    attachments: [],
    text: "Preview",
    html: "<div>Preview</div>",
    ...overrides,
  };
}

describe("mail workbench switching state", () => {
  it("requests detail hydration when a selected message only has summary content", async () => {
    const { maybeHydrateSelectedMessage } = await import("@/components/mail-workbench");

    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));

    await maybeHydrateSelectedMessage(buildMailDetail({
      id: "qq-message-1",
      subject: "Summary only",
      preview: "Summary only",
      text: "Summary only",
      html: "<div>Summary only</div>",
    }));

    expect(fetchMock).toHaveBeenCalledWith("/api/messages/qq-message-1/hydrate", {
      method: "POST",
    });
  });

  it("shows a detail loading placeholder while the selected message detail is catching up", () => {
    expect(shouldShowDetailLoading("next-message", "previous-message", null)).toBe(true);
    expect(shouldShowDetailLoading("next-message", undefined, null)).toBe(true);
    expect(shouldShowDetailLoading("next-message", "next-message", null)).toBe(false);
    expect(shouldShowDetailLoading(null, "same-message", "same-message")).toBe(true);
    expect(shouldShowDetailLoading(null, "same-message", null)).toBe(false);
    expect(shouldShowDetailLoading(null, "previous-message", null)).toBe(false);
  });

  it("clears the hydrating state immediately after hydrate completes", () => {
    expect(getHydratingMessageIdAfterHydration("qq-message-1", true)).toBe(null);
    expect(getHydratingMessageIdAfterHydration("qq-message-1", false)).toBe(null);
    expect(getHydratingMessageIdAfterHydration(null, true)).toBe(null);
  });

  it("treats summary-only content as requiring hydration", () => {
    expect(needsMessageHydration({
      subject: "Summary only",
      preview: "Summary only",
      text: "Summary only",
      html: "<div>Summary only</div>",
    })).toBe(true);

    expect(needsMessageHydration({
      subject: "Summary only",
      preview: "Summary only",
      text: "Full body content",
      html: "<p>Full body content</p>",
    })).toBe(false);

    expect(needsMessageHydration({
      subject: "This message contains HTML content.",
      preview: "This message contains HTML content.",
      text: "This message contains HTML content.",
      html: "<!doctype html><html><body><p>Actual HTML body</p></body></html>",
    })).toBe(false);
  });
});
