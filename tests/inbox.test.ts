import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import {
  clearAllMessages,
  clearMailboxMessages,
  listMessages,
  listProviderMailboxes,
  markMessageAsRead,
  saveImapConfig,
  updateMessageDetail,
  upsertMessages,
} from "@/lib/provider-store";

const hydrateMessageDetailMock = vi.fn();

vi.mock("@/lib/provider-sync", () => ({
  hydrateMessageDetail: hydrateMessageDetailMock,
}));

async function importInbox() {
  return import("@/lib/inbox");
}

describe("queryInbox", () => {
  beforeEach(() => {
    const db = getDb();
    db.prepare("DELETE FROM messages").run();
    db.prepare("DELETE FROM providers").run();
    db.prepare("DELETE FROM app_settings").run();
    hydrateMessageDetailMock.mockReset();
  });

  it("returns empty unified inbox with providers", async () => {
    const { queryInbox } = await importInbox();
    const inbox = await queryInbox({});
    expect(inbox.providers).toHaveLength(4);
    expect(inbox.messages).toHaveLength(0);
    expect(inbox.selectedMessage).toBeUndefined();
  });

  it("keeps unread filter empty before sync", async () => {
    const { queryInbox } = await importInbox();
    const inbox = await queryInbox({ filter: "unread" });
    expect(inbox.messages).toHaveLength(0);
  });

  it("keeps source filter empty before sync", async () => {
    const { queryInbox } = await importInbox();
    const inbox = await queryInbox({ source: "gmail" });
    expect(inbox.messages).toHaveLength(0);
  });

  it("keeps local read state when sync reports message unread again", () => {
    const message = {
      id: "qq-test-1",
      providerId: "qq" as const,
      mailboxId: "qq-test",
      providerLabel: "QQ Mail",
      from: "sender@example.com",
      subject: "Test",
      preview: "Preview",
      receivedAt: "2026-05-22T00:00:00.000Z",
      unread: true,
      hasAttachments: false,
      tags: [],
      attachments: [],
      text: "Preview",
      html: "<p>Preview</p>",
    };

    upsertMessages("qq-test", "qq", [message]);
    markMessageAsRead(message.id);
    upsertMessages("qq-test", "qq", [{ ...message, subject: "Test refreshed", unread: true }]);

    const stored = listMessages().find((item) => item.id === message.id);
    expect(stored?.subject).toBe("Test refreshed");
    expect(stored?.unread).toBe(false);
  });

  it("keeps local read state when detail hydration reports message unread again", () => {
    const message = {
      id: "qq-test-detail-read",
      providerId: "qq" as const,
      mailboxId: "qq-test",
      providerLabel: "QQ Mail",
      from: "sender@example.com",
      subject: "Detail read",
      preview: "Preview",
      receivedAt: "2026-05-22T00:00:00.000Z",
      unread: true,
      hasAttachments: false,
      tags: [],
      attachments: [],
      text: "Preview",
      html: "<p>Preview</p>",
    };

    upsertMessages("qq-test", "qq", [message]);
    markMessageAsRead(message.id);
    updateMessageDetail(message.id, {
      text: "Hydrated body",
      html: "<p>Hydrated body</p>",
      unread: true,
    });

    const stored = listMessages().find((item) => item.id === message.id);
    expect(stored?.unread).toBe(false);
  });

  it("does not mark a message as read when inbox query auto-selects it", async () => {
    const message = {
      id: "qq-test-auto-read",
      providerId: "qq" as const,
      mailboxId: "qq-test",
      providerLabel: "QQ Mail",
      from: "sender@example.com",
      subject: "Auto read check",
      preview: "Preview",
      receivedAt: "2026-05-22T00:00:00.000Z",
      unread: true,
      hasAttachments: false,
      tags: [],
      attachments: [],
      text: "Preview",
      html: "<p>Preview</p>",
    };

    upsertMessages("qq-test", "qq", [message]);

    const { queryInbox } = await importInbox();
    const inbox = await queryInbox({});
    expect(inbox.selectedMessage?.id).toBe(message.id);

    const stored = listMessages().find((item) => item.id === message.id);
    expect(stored?.unread).toBe(true);
  });

  it("does not hydrate selected message detail during inbox query", async () => {
    const message = {
      id: "qq-test-no-hydrate",
      providerId: "qq" as const,
      mailboxId: "qq-test",
      providerLabel: "QQ Mail",
      from: "sender@example.com",
      subject: "No hydrate",
      preview: "Preview",
      receivedAt: "2026-05-22T00:00:00.000Z",
      unread: true,
      hasAttachments: false,
      tags: [],
      attachments: [],
      text: "",
      html: "",
    };

    upsertMessages("qq-test", "qq", [message]);

    const { queryInbox } = await importInbox();
    const inbox = await queryInbox({});

    expect(inbox.selectedMessage?.id).toBe(message.id);
    expect(hydrateMessageDetailMock).not.toHaveBeenCalled();
  });

  it("marks a manually selected message as read during inbox query", async () => {
    const message = {
      id: "qq-test-manual-read",
      providerId: "qq" as const,
      mailboxId: "qq-test",
      providerLabel: "QQ Mail",
      from: "sender@example.com",
      subject: "Manual read",
      preview: "Preview",
      receivedAt: "2026-05-22T00:00:00.000Z",
      unread: true,
      hasAttachments: false,
      tags: [],
      attachments: [],
      text: "Preview",
      html: "<p>Preview</p>",
    };

    upsertMessages("qq-test", "qq", [message]);

    const { queryInbox } = await importInbox();
    const inbox = await queryInbox({ selectedId: message.id });

    expect(inbox.selectedMessage?.id).toBe(message.id);
    expect(inbox.selectedMessage?.unread).toBe(false);
    expect(inbox.messages.find((item) => item.id === message.id)?.unread).toBe(false);

    const stored = listMessages().find((item) => item.id === message.id);
    expect(stored?.unread).toBe(false);
  });

  it("clears only the selected mailbox messages while keeping other mailboxes intact", () => {
    saveImapConfig({
      providerId: "qq",
      mailboxId: "qq-box-a",
      account: "user-a@qq.com",
      authorizationCode: "auth-a",
      imapHost: "imap.qq.com",
      imapPort: 993,
    });
    saveImapConfig({
      providerId: "qq",
      mailboxId: "qq-box-b",
      account: "user-b@qq.com",
      authorizationCode: "auth-b",
      imapHost: "imap.qq.com",
      imapPort: 993,
    });

    upsertMessages("qq-box-a", "qq", [{
      id: "qq-a-1",
      providerId: "qq" as const,
      mailboxId: "qq-box-a",
      providerLabel: "QQ Mail",
      from: "sender-a@example.com",
      subject: "A",
      preview: "A",
      receivedAt: "2026-05-22T00:00:00.000Z",
      unread: true,
      hasAttachments: false,
      tags: [],
      attachments: [],
      text: "A",
      html: "<p>A</p>",
    }]);
    upsertMessages("qq-box-b", "qq", [{
      id: "qq-b-1",
      providerId: "qq" as const,
      mailboxId: "qq-box-b",
      providerLabel: "QQ Mail",
      from: "sender-b@example.com",
      subject: "B",
      preview: "B",
      receivedAt: "2026-05-22T00:00:00.000Z",
      unread: true,
      hasAttachments: false,
      tags: [],
      attachments: [],
      text: "B",
      html: "<p>B</p>",
    }]);

    clearMailboxMessages("qq", "qq-box-a");

    const messages = listMessages();
    expect(messages.find((item) => item.id === "qq-a-1")).toBeUndefined();
    expect(messages.find((item) => item.id === "qq-b-1")).toBeDefined();
  });

  it("clears all cached mailbox messages while keeping mailbox configs intact", () => {
    saveImapConfig({
      providerId: "qq",
      mailboxId: "qq-box-a",
      account: "user-a@qq.com",
      authorizationCode: "auth-a",
      imapHost: "imap.qq.com",
      imapPort: 993,
    });
    saveImapConfig({
      providerId: "mail163",
      mailboxId: "mail163-box-a",
      account: "user-a@163.com",
      authorizationCode: "auth-b",
      imapHost: "imap.163.com",
      imapPort: 993,
    });

    upsertMessages("qq-box-a", "qq", [{
      id: "qq-a-1",
      providerId: "qq" as const,
      mailboxId: "qq-box-a",
      providerLabel: "QQ Mail",
      from: "sender-a@example.com",
      subject: "A",
      preview: "A",
      receivedAt: "2026-05-22T00:00:00.000Z",
      unread: true,
      hasAttachments: false,
      tags: [],
      attachments: [],
      text: "A",
      html: "<p>A</p>",
    }]);
    upsertMessages("mail163-box-a", "mail163", [{
      id: "mail163-a-1",
      providerId: "mail163" as const,
      mailboxId: "mail163-box-a",
      providerLabel: "163 Mail",
      from: "sender-b@example.com",
      subject: "B",
      preview: "B",
      receivedAt: "2026-05-22T00:00:00.000Z",
      unread: true,
      hasAttachments: false,
      tags: [],
      attachments: [],
      text: "B",
      html: "<p>B</p>",
    }]);

    clearAllMessages();

    expect(listMessages()).toHaveLength(0);
    expect(listProviderMailboxes("qq")).toHaveLength(1);
    expect(listProviderMailboxes("mail163")).toHaveLength(1);
  });
});
