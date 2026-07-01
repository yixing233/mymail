import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAutoSyncFetchLimit,
  getBulkSyncFetchLimit,
  getSingleSyncFetchLimit,
  setAutoSyncFetchLimit,
  setBulkSyncFetchLimit,
  setSingleSyncFetchLimit,
} from "@/lib/app-settings";
import { getDb } from "@/lib/db";

const refreshProviderMock = vi.fn();

vi.mock("@/lib/provider-sync", () => ({
  refreshProvider: refreshProviderMock,
}));

describe("mail fetch limit settings", () => {
  beforeEach(() => {
    const db = getDb();
    db.prepare("DELETE FROM messages").run();
    db.prepare("DELETE FROM providers").run();
    db.prepare("DELETE FROM app_settings").run();
    refreshProviderMock.mockReset();
    process.env.MYMAIL_GMAIL_CLIENT_ID = "test-gmail-client";
    process.env.MYMAIL_GMAIL_CLIENT_SECRET = "test-gmail-secret";
    process.env.MYMAIL_OUTLOOK_CLIENT_ID = "test-outlook-client";
    process.env.MYMAIL_OUTLOOK_CLIENT_SECRET = "test-outlook-secret";
  });

  it("returns default fetch limits when settings are missing", () => {
    expect(getSingleSyncFetchLimit()).toBe(30);
    expect(getBulkSyncFetchLimit()).toBe(30);
    expect(getAutoSyncFetchLimit()).toBe(30);
  });

  it("persists custom fetch limits", () => {
    expect(setSingleSyncFetchLimit(18)).toBe(18);
    expect(setBulkSyncFetchLimit(9)).toBe(9);
    expect(setAutoSyncFetchLimit(6)).toBe(6);
    expect(getSingleSyncFetchLimit()).toBe(18);
    expect(getBulkSyncFetchLimit()).toBe(9);
    expect(getAutoSyncFetchLimit()).toBe(6);
  });

  it("rejects unsupported fetch limits", () => {
    expect(() => setSingleSyncFetchLimit(0)).toThrow("邮件获取数量必须在 1 到 200 之间");
    expect(() => setBulkSyncFetchLimit(201)).toThrow("邮件获取数量必须在 1 到 200 之间");
    expect(() => setAutoSyncFetchLimit(0)).toThrow("邮件获取数量必须在 1 到 200 之间");
  });

  it("uses single mailbox fetch limit for manual refresh", async () => {
    refreshProviderMock.mockResolvedValue({ count: 12 });
    setSingleSyncFetchLimit(12);
    const { refreshProvider } = await import("@/lib/provider-sync");

    await refreshProvider("gmail", "gmail-box-1", { limit: getSingleSyncFetchLimit() });

    expect(refreshProviderMock).toHaveBeenCalledWith("gmail", "gmail-box-1", { limit: 12 });
  });

  it("persists mailbox-level fetch limit on provider config", async () => {
    const providerStore = await import("@/lib/provider-store");
    const mailboxId = providerStore.saveImapConfig({
      providerId: "qq",
      account: "user@qq.com",
      authorizationCode: "auth-code",
      imapHost: "imap.qq.com",
      imapPort: 993,
      syncFetchLimit: 21,
    });

    expect(providerStore.getProviderFormState("qq", mailboxId).syncFetchLimit).toBe(21);
    expect(providerStore.getProviderPayload("qq", mailboxId).syncFetchLimit).toBe(21);
  });

  it("uses mailbox-level fetch limit for manual refresh when configured", async () => {
    setSingleSyncFetchLimit(12);
    refreshProviderMock.mockResolvedValue({ count: 21 });
    const providerStore = await import("@/lib/provider-store");
    const mailboxId = providerStore.saveOAuthConfig({
      providerId: "gmail",
      account: "user@gmail.com",
      syncFetchLimit: 21,
    });

    const routeModule = await import("@/app/api/providers/[providerId]/route");
    const request = new Request("http://localhost/api/providers/gmail", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "refresh", mailboxId }),
    });

    const response = await routeModule.POST(request as never, {
      params: Promise.resolve({ providerId: "gmail" }),
    });

    expect(response.status).toBe(200);
    expect(refreshProviderMock).toHaveBeenCalledWith("gmail", mailboxId, { limit: 21 });
  });

  it("uses bulk fetch limit for bulk sync runner", async () => {
    setBulkSyncFetchLimit(7);
    refreshProviderMock.mockResolvedValue({ count: 7 });
    const syncRunner = await import("@/lib/sync-runner");
    const providerStore = await import("@/lib/provider-store");

    providerStore.saveOAuthConfig({
      providerId: "gmail",
      account: "user1@gmail.com",
    });
    providerStore.saveOAuthConfig({
      providerId: "outlook",
      account: "user2@outlook.com",
      tenantId: "common",
    });

    await syncRunner.syncAllMailboxes();

    expect(refreshProviderMock).toHaveBeenNthCalledWith(1, "gmail", expect.any(String), { limit: 7 });
    expect(refreshProviderMock).toHaveBeenNthCalledWith(2, "outlook", expect.any(String), { limit: 7 });
  });

  it("uses auto fetch limit for auto sync runner", async () => {
    setBulkSyncFetchLimit(7);
    setAutoSyncFetchLimit(4);
    refreshProviderMock.mockResolvedValue({ count: 4 });
    const syncRunner = await import("@/lib/sync-runner");
    const providerStore = await import("@/lib/provider-store");

    providerStore.saveOAuthConfig({
      providerId: "gmail",
      account: "user1@gmail.com",
    });
    providerStore.saveOAuthConfig({
      providerId: "outlook",
      account: "user2@outlook.com",
      tenantId: "common",
    });

    await syncRunner.syncAllMailboxes({ trigger: "auto" });

    expect(refreshProviderMock).toHaveBeenNthCalledWith(1, "gmail", expect.any(String), { limit: 4 });
    expect(refreshProviderMock).toHaveBeenNthCalledWith(2, "outlook", expect.any(String), { limit: 4 });
  });
});
