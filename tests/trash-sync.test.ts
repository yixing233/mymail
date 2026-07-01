import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { getMessageDetail } from "@/lib/provider-store";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

async function importProviderSync() {
  return import("@/lib/provider-sync");
}

function createDeferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function encodeRawMessage(rawMessage: string) {
  return Buffer.from(rawMessage)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

describe("provider sync trash folders", () => {
  beforeEach(() => {
    const db = getDb();
    db.prepare("DELETE FROM messages").run();
    db.prepare("DELETE FROM providers").run();
    fetchMock.mockReset();
    process.env.MYMAIL_GMAIL_CLIENT_ID = "test-gmail-client";
    process.env.MYMAIL_GMAIL_CLIENT_SECRET = "test-gmail-secret";
    process.env.MYMAIL_OUTLOOK_CLIENT_ID = "test-outlook-client";
    process.env.MYMAIL_OUTLOOK_CLIENT_SECRET = "test-outlook-secret";
  });

  it("requests gmail inbox and spam labels", async () => {
    const providerStore = await import("@/lib/provider-store");
    const mailboxId = providerStore.saveOAuthConfig({ providerId: "gmail", account: "user@gmail.com" });
    providerStore.updateProviderConnectionState({
      providerId: "gmail",
      mailboxId,
      account: "user@gmail.com",
      status: "connected",
      health: "healthy",
      lastSyncedAt: new Date().toISOString(),
      tokenPayload: { refreshToken: "refresh-token" },
    });

    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "token", expires_in: 3600, token_type: "Bearer" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ emailAddress: "user@gmail.com" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ messages: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ messages: [] }), { status: 200 }));

    const providerSync = await importProviderSync();
    await providerSync.refreshProvider("gmail", mailboxId, { limit: 10 });

    const listCalls = fetchMock.mock.calls
      .map((call) => call[0])
      .filter((value) => typeof value === "object" && value instanceof URL) as URL[];

    expect(listCalls).toHaveLength(2);
    expect(listCalls[0].searchParams.get("labelIds")).toBe("INBOX");
    expect(listCalls[1].searchParams.get("labelIds")).toBe("SPAM");
  });

  it("stores gmail full message bodies during sync", async () => {
    const providerStore = await import("@/lib/provider-store");
    const mailboxId = providerStore.saveOAuthConfig({ providerId: "gmail", account: "user@gmail.com" });
    providerStore.updateProviderConnectionState({
      providerId: "gmail",
      mailboxId,
      account: "user@gmail.com",
      status: "connected",
      health: "healthy",
      lastSyncedAt: new Date().toISOString(),
      tokenPayload: { refreshToken: "refresh-token" },
    });

    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "token", expires_in: 3600, token_type: "Bearer" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ emailAddress: "user@gmail.com" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ messages: [{ id: "gmail-msg-1", threadId: "thread-1" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ messages: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "gmail-msg-1",
        labelIds: ["UNREAD"],
        snippet: "Snippet preview",
        internalDate: "1780000000000",
        raw: encodeRawMessage([
          "From: Sender <sender@example.com>",
          "Subject: Full Gmail body",
          "Content-Type: text/html; charset=utf-8",
          "",
          "<p>Full Gmail body</p>",
        ].join("\r\n")),
      }), { status: 200 }));

    const providerSync = await importProviderSync();
    await providerSync.refreshProvider("gmail", mailboxId, { limit: 10 });

    const detail = getMessageDetail(`${mailboxId}-gmail-msg-1`);
    expect(detail).toBeDefined();
    expect(detail!.subject).toBe("Full Gmail body");
    expect(detail!.html).toContain("<p>Full Gmail body</p>");

    const rawFetchCalls = fetchMock.mock.calls
      .map((call) => String(call[0]))
      .filter((url) => url.includes("/messages/") && url.includes("format=raw"));
    expect(rawFetchCalls).toHaveLength(1);
  });

  it("limits gmail total synced messages across labels to the requested count", async () => {
    const providerStore = await import("@/lib/provider-store");
    const mailboxId = providerStore.saveOAuthConfig({ providerId: "gmail", account: "user@gmail.com" });
    providerStore.updateProviderConnectionState({
      providerId: "gmail",
      mailboxId,
      account: "user@gmail.com",
      status: "connected",
      health: "healthy",
      lastSyncedAt: new Date().toISOString(),
      tokenPayload: { refreshToken: "refresh-token" },
    });

    fetchMock.mockImplementation((input) => {
      const url = String(input);

      if (url === "https://oauth2.googleapis.com/token") {
        return Promise.resolve(new Response(JSON.stringify({ access_token: "token", expires_in: 3600, token_type: "Bearer" }), { status: 200 }));
      }

      if (url === "https://gmail.googleapis.com/gmail/v1/users/me/profile") {
        return Promise.resolve(new Response(JSON.stringify({ emailAddress: "user@gmail.com" }), { status: 200 }));
      }

      if (url.includes("/users/me/messages?") && url.includes("labelIds=INBOX")) {
        return Promise.resolve(new Response(JSON.stringify({
          messages: [
            { id: "gmail-msg-1", threadId: "thread-1" },
            { id: "gmail-msg-2", threadId: "thread-2" },
          ],
        }), { status: 200 }));
      }

      if (url.includes("/users/me/messages?") && url.includes("labelIds=SPAM")) {
        return Promise.resolve(new Response(JSON.stringify({
          messages: [
            { id: "gmail-msg-3", threadId: "thread-3" },
            { id: "gmail-msg-4", threadId: "thread-4" },
          ],
        }), { status: 200 }));
      }

      if (url.includes("/messages/gmail-msg-1?format=raw")) {
        return Promise.resolve(new Response(JSON.stringify({
          id: "gmail-msg-1",
          snippet: "One",
          internalDate: "1780000000000",
          raw: encodeRawMessage("Subject: One\r\n\r\nOne full body"),
        }), { status: 200 }));
      }

      if (url.includes("/messages/gmail-msg-2?format=raw")) {
        return Promise.resolve(new Response(JSON.stringify({
          id: "gmail-msg-2",
          snippet: "Two",
          internalDate: "1780000001000",
          raw: encodeRawMessage("Subject: Two\r\n\r\nTwo full body"),
        }), { status: 200 }));
      }

      if (url.includes("/messages/gmail-msg-3?format=raw")) {
        return Promise.resolve(new Response(JSON.stringify({
          id: "gmail-msg-3",
          snippet: "Three",
          internalDate: "1780000002000",
          raw: encodeRawMessage("Subject: Three\r\n\r\nThree full body"),
        }), { status: 200 }));
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    const providerSync = await importProviderSync();
    const result = await providerSync.refreshProvider("gmail", mailboxId, { limit: 3 });

    expect(result).toEqual({ count: 3 });
    expect(providerStore.listMessages().filter((message) => message.mailboxId === mailboxId)).toHaveLength(3);
    const rawFetches = fetchMock.mock.calls
      .map((call) => String(call[0]))
      .filter((url) => url.includes("?format=raw"));
    expect(rawFetches).toHaveLength(3);
  });

  it("starts multiple gmail summary fetches without waiting for each previous message", async () => {
    const providerStore = await import("@/lib/provider-store");
    const mailboxId = providerStore.saveOAuthConfig({ providerId: "gmail", account: "user@gmail.com" });
    providerStore.updateProviderConnectionState({
      providerId: "gmail",
      mailboxId,
      account: "user@gmail.com",
      status: "connected",
      health: "healthy",
      lastSyncedAt: new Date().toISOString(),
      tokenPayload: { refreshToken: "refresh-token" },
    });

    const firstSummary = createDeferredResponse();
    const secondSummary = createDeferredResponse();
    const startedSummaryIds: string[] = [];

    fetchMock.mockImplementation((input) => {
      const url = String(input);

      if (url === "https://oauth2.googleapis.com/token") {
        return Promise.resolve(new Response(JSON.stringify({ access_token: "token", expires_in: 3600, token_type: "Bearer" }), { status: 200 }));
      }

      if (url === "https://gmail.googleapis.com/gmail/v1/users/me/profile") {
        return Promise.resolve(new Response(JSON.stringify({ emailAddress: "user@gmail.com" }), { status: 200 }));
      }

      if (url.includes("/users/me/messages?") && url.includes("labelIds=INBOX")) {
        return Promise.resolve(new Response(JSON.stringify({
          messages: [
            { id: "gmail-msg-1", threadId: "thread-1" },
            { id: "gmail-msg-2", threadId: "thread-2" },
          ],
        }), { status: 200 }));
      }

      if (url.includes("/users/me/messages?") && url.includes("labelIds=SPAM")) {
        return Promise.resolve(new Response(JSON.stringify({ messages: [] }), { status: 200 }));
      }

      if (url.includes("/messages/gmail-msg-1?format=raw")) {
        startedSummaryIds.push("gmail-msg-1");
        return firstSummary.promise;
      }

      if (url.includes("/messages/gmail-msg-2?format=raw")) {
        startedSummaryIds.push("gmail-msg-2");
        return secondSummary.promise;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    const providerSync = await importProviderSync();
    const refreshPromise = providerSync.refreshProvider("gmail", mailboxId, { limit: 10 });

    await new Promise((resolve) => setImmediate(resolve));

    expect(startedSummaryIds).toEqual(["gmail-msg-1", "gmail-msg-2"]);

    firstSummary.resolve(new Response(JSON.stringify({
      id: "gmail-msg-1",
      labelIds: ["UNREAD"],
      snippet: "First summary",
      internalDate: "1780000000000",
      raw: encodeRawMessage("Subject: First subject\r\n\r\nFirst full body"),
    }), { status: 200 }));
    secondSummary.resolve(new Response(JSON.stringify({
      id: "gmail-msg-2",
      labelIds: [],
      snippet: "Second summary",
      internalDate: "1780000001000",
      raw: encodeRawMessage("Subject: Second subject\r\n\r\nSecond full body"),
    }), { status: 200 }));

    await refreshPromise;
  });

  it("requests outlook inbox and junk folders", async () => {
    const providerStore = await import("@/lib/provider-store");
    const mailboxId = providerStore.saveOAuthConfig({ providerId: "outlook", account: "user@outlook.com", tenantId: "common" });
    providerStore.updateProviderConnectionState({
      providerId: "outlook",
      mailboxId,
      account: "user@outlook.com",
      status: "connected",
      health: "healthy",
      lastSyncedAt: new Date().toISOString(),
      tokenPayload: { refreshToken: "refresh-token" },
    });

    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "token", expires_in: 3600, token_type: "Bearer" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ userPrincipalName: "user@outlook.com" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: [] }), { status: 200 }));

    const providerSync = await importProviderSync();
    await providerSync.refreshProvider("outlook", mailboxId, { limit: 10 });

    const urls = fetchMock.mock.calls
      .map((call) => call[0])
      .filter((value) => value instanceof URL)
      .map((value) => String(value))
      .filter((value) => value.includes("graph.microsoft.com/v1.0/me/mailFolders/"));

    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("/mailFolders/inbox/messages");
    expect(urls[1]).toContain("/mailFolders/junkemail/messages");
  });

  it("requests outlook list messages with body payload during sync", async () => {
    const providerStore = await import("@/lib/provider-store");
    const mailboxId = providerStore.saveOAuthConfig({ providerId: "outlook", account: "user@outlook.com", tenantId: "common" });
    providerStore.updateProviderConnectionState({
      providerId: "outlook",
      mailboxId,
      account: "user@outlook.com",
      status: "connected",
      health: "healthy",
      lastSyncedAt: new Date().toISOString(),
      tokenPayload: { refreshToken: "refresh-token" },
    });

    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "token", expires_in: 3600, token_type: "Bearer" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ userPrincipalName: "user@outlook.com" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: [] }), { status: 200 }));

    const providerSync = await importProviderSync();
    await providerSync.refreshProvider("outlook", mailboxId, { limit: 10 });

    const listCalls = fetchMock.mock.calls
      .map((call) => call[0])
      .filter((value) => value instanceof URL) as URL[];
    const outlookListCalls = listCalls.filter((url) => url.pathname.includes("/mailFolders/") && url.pathname.endsWith("/messages"));

    expect(outlookListCalls).toHaveLength(2);
    outlookListCalls.forEach((url) => {
      expect(url.searchParams.get("$select")).toBe("id,subject,bodyPreview,receivedDateTime,from,isRead,hasAttachments,body");
    });
  });

  it("stores outlook full message bodies without eager attachment detail calls during sync", async () => {
    const providerStore = await import("@/lib/provider-store");
    const mailboxId = providerStore.saveOAuthConfig({ providerId: "outlook", account: "user@outlook.com", tenantId: "common" });
    providerStore.updateProviderConnectionState({
      providerId: "outlook",
      mailboxId,
      account: "user@outlook.com",
      status: "connected",
      health: "healthy",
      lastSyncedAt: new Date().toISOString(),
      tokenPayload: { refreshToken: "refresh-token" },
    });

    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "token", expires_in: 3600, token_type: "Bearer" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ userPrincipalName: "user@outlook.com" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        value: [
          {
            id: "outlook-msg-1",
            subject: "Inbox summary",
            bodyPreview: "Preview text",
            receivedDateTime: "2026-06-05T00:00:00.000Z",
            from: { emailAddress: { address: "sender@example.com", name: "Sender" } },
            isRead: false,
            hasAttachments: true,
            body: { contentType: "html", content: "<p>Full Outlook body</p>" },
          },
        ],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: [{ id: "att-1", name: "file.txt", size: 1024 }] }), { status: 200 }));

    const providerSync = await importProviderSync();
    await providerSync.refreshProvider("outlook", mailboxId, { limit: 10 });

    const detail = getMessageDetail(`${mailboxId}-outlook-msg-1`);
    expect(detail).toBeDefined();
    expect(detail!.text).toBe("Preview text");
    expect(detail!.html).toContain("<p>Full Outlook body</p>");
    expect(detail!.hasAttachments).toBe(true);
    expect(detail!.attachments).toEqual([]);

    const attachmentCalls = fetchMock.mock.calls
      .map((call) => String(call[0]))
      .filter((url) => url.includes("/attachments?$select=id,name,size"));
    expect(attachmentCalls).toHaveLength(0);
  });

  it("limits outlook total synced messages across folders to the requested count", async () => {
    const providerStore = await import("@/lib/provider-store");
    const mailboxId = providerStore.saveOAuthConfig({ providerId: "outlook", account: "user@outlook.com", tenantId: "common" });
    providerStore.updateProviderConnectionState({
      providerId: "outlook",
      mailboxId,
      account: "user@outlook.com",
      status: "connected",
      health: "healthy",
      lastSyncedAt: new Date().toISOString(),
      tokenPayload: { refreshToken: "refresh-token" },
    });

    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "token", expires_in: 3600, token_type: "Bearer" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ userPrincipalName: "user@outlook.com" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        value: [
          { id: "outlook-msg-1", subject: "One", bodyPreview: "One", receivedDateTime: "2026-06-05T00:00:03.000Z", from: { emailAddress: { address: "a@example.com" } }, isRead: false, hasAttachments: false },
          { id: "outlook-msg-2", subject: "Two", bodyPreview: "Two", receivedDateTime: "2026-06-05T00:00:02.000Z", from: { emailAddress: { address: "b@example.com" } }, isRead: false, hasAttachments: false },
        ],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        value: [
          { id: "outlook-msg-3", subject: "Three", bodyPreview: "Three", receivedDateTime: "2026-06-05T00:00:01.000Z", from: { emailAddress: { address: "c@example.com" } }, isRead: false, hasAttachments: false },
          { id: "outlook-msg-4", subject: "Four", bodyPreview: "Four", receivedDateTime: "2026-06-05T00:00:00.000Z", from: { emailAddress: { address: "d@example.com" } }, isRead: false, hasAttachments: false },
        ],
      }), { status: 200 }));

    const providerSync = await importProviderSync();
    const result = await providerSync.refreshProvider("outlook", mailboxId, { limit: 3 });

    expect(result).toEqual({ count: 3 });
    expect(providerStore.listMessages().filter((message) => message.mailboxId === mailboxId)).toHaveLength(3);
  });

  it("caps outlook sync to three messages even when a larger limit is requested", async () => {
    const providerStore = await import("@/lib/provider-store");
    const mailboxId = providerStore.saveOAuthConfig({ providerId: "outlook", account: "user@outlook.com", tenantId: "common" });
    providerStore.updateProviderConnectionState({
      providerId: "outlook",
      mailboxId,
      account: "user@outlook.com",
      status: "connected",
      health: "healthy",
      lastSyncedAt: new Date().toISOString(),
      tokenPayload: { refreshToken: "refresh-token" },
    });

    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "token", expires_in: 3600, token_type: "Bearer" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ userPrincipalName: "user@outlook.com" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        value: [
          { id: "outlook-msg-1", subject: "One", bodyPreview: "One", receivedDateTime: "2026-06-05T00:00:03.000Z", from: { emailAddress: { address: "a@example.com" } }, isRead: false, hasAttachments: false, body: { contentType: "html", content: "<p>One</p>" } },
          { id: "outlook-msg-2", subject: "Two", bodyPreview: "Two", receivedDateTime: "2026-06-05T00:00:02.000Z", from: { emailAddress: { address: "b@example.com" } }, isRead: false, hasAttachments: false, body: { contentType: "html", content: "<p>Two</p>" } },
          { id: "outlook-msg-3", subject: "Three", bodyPreview: "Three", receivedDateTime: "2026-06-05T00:00:01.000Z", from: { emailAddress: { address: "c@example.com" } }, isRead: false, hasAttachments: false, body: { contentType: "html", content: "<p>Three</p>" } },
        ],
      }), { status: 200 }));

    const providerSync = await importProviderSync();
    const result = await providerSync.refreshProvider("outlook", mailboxId, { limit: 10 });

    expect(result).toEqual({ count: 3 });
    expect(providerStore.listMessages().filter((message) => message.mailboxId === mailboxId)).toHaveLength(3);
    const outlookListCalls = fetchMock.mock.calls
      .map((call) => call[0])
      .filter((value) => value instanceof URL) as URL[];
    expect(outlookListCalls[0].searchParams.get("$top")).toBe("3");
  });

  it("refreshes imported outlook accounts through imap by default", async () => {
    vi.resetModules();
    const rawMessage = [
      "From: Sender <sender@example.com>",
      "Subject: Imported IMAP subject",
      "Date: Fri, 05 Jun 2026 00:00:00 +0000",
      "Content-Type: text/html; charset=utf-8",
      "",
      "<p>Imported IMAP full body</p>",
    ].join("\r\n");
    const openMock = vi.fn(async (mailboxName: string) => ({ exists: mailboxName === "INBOX" ? 1 : 0 }));
    const connectMock = vi.fn(async () => undefined);
    const logoutMock = vi.fn(async () => undefined);
    const closeMock = vi.fn(() => undefined);
    const fetchMockImap = vi.fn((_range: string) => {
      async function* items() {
        yield {
          uid: 42,
          envelope: { from: [{ address: "sender@example.com" }], subject: "Imported IMAP subject" },
          flags: new Set(),
          internalDate: new Date("2026-06-05T00:00:00.000Z"),
          source: Buffer.from(rawMessage),
        };
      }
      return items();
    });
    const imapFlowMock = vi.fn().mockImplementation(() => {
      const client = {
        connect: connectMock,
        mailboxOpen: vi.fn(async (mailboxName: string) => {
          const exists = mailboxName === "INBOX" ? 1 : 0;
          client.mailbox.exists = exists;
          return { exists };
        }),
        fetch: fetchMockImap,
        logout: logoutMock,
        close: closeMock,
        mailbox: { exists: 0 },
      };
      return client;
    });

    vi.doMock("imapflow", () => ({
      ImapFlow: imapFlowMock,
    }));

    const providerStore = await import("@/lib/provider-store");
    const imported = providerStore.upsertImportedOutlookMailbox({
      account: "user@outlook.com",
      password: "pass-one",
      clientId: "client-one",
      refreshToken: "refresh-one",
    });

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      access_token: "imap-token",
      expires_in: 3600,
      token_type: "Bearer",
    }), { status: 200 }));

    const providerSync = await importProviderSync();
    const result = await providerSync.refreshProvider("outlook", imported.mailboxId, { limit: 10 });

    expect(result).toEqual({ count: 1 });
    expect(imapFlowMock).toHaveBeenCalled();
    expect(fetchMock.mock.calls).toHaveLength(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/oauth2/v2.0/token");
    const detail = providerStore.listMessages().find((message) => message.mailboxId === imported.mailboxId);
    expect(detail?.subject).toBe("Imported IMAP subject");
    const hydratedDetail = providerStore.getMessageDetail(`${imported.mailboxId}-INBOX-42`);
    expect(hydratedDetail?.html).toContain("<p>Imported IMAP full body</p>");
    expect(fetchMockImap).toHaveBeenCalledWith("1:*", {
      uid: true,
      envelope: true,
      flags: true,
      internalDate: true,
      source: true,
    });
  });

  it("tries imap inbox and junk mailboxes", async () => {
    vi.resetModules();
    const openMock = vi.fn(async (_mailboxName: string) => ({ exists: 0 }));
    const connectMock = vi.fn(async () => undefined);
    const logoutMock = vi.fn(async () => undefined);
    const closeMock = vi.fn(() => undefined);

    vi.doMock("imapflow", () => ({
      ImapFlow: vi.fn().mockImplementation(() => ({
        connect: connectMock,
        mailboxOpen: openMock,
        fetch: vi.fn(),
        logout: logoutMock,
        close: closeMock,
        mailbox: { exists: 0 },
      })),
    }));

    const providerStore = await import("@/lib/provider-store");
    const mailboxId = providerStore.saveImapConfig({
      providerId: "qq",
      account: "user@qq.com",
      authorizationCode: "auth-code",
      imapHost: "imap.qq.com",
      imapPort: 993,
    });

    const providerSync = await importProviderSync();
    await providerSync.refreshProvider("qq", mailboxId, { limit: 10 });

    const openedMailboxes = openMock.mock.calls.reduce<string[]>((result, call) => {
      const mailboxName = call[0];
      if (typeof mailboxName === "string") {
        result.push(mailboxName);
      }
      return result;
    }, []);
    expect(openedMailboxes[0]).toBe("INBOX");
    expect(openedMailboxes).toContain("Junk");
  });

  it("tries outlook imap inbox and junk mailbox aliases", async () => {
    vi.resetModules();
    const openMock = vi.fn(async (_mailboxName: string) => ({ exists: 0 }));
    const connectMock = vi.fn(async () => undefined);
    const logoutMock = vi.fn(async () => undefined);
    const closeMock = vi.fn(() => undefined);

    vi.doMock("imapflow", () => ({
      ImapFlow: vi.fn().mockImplementation(() => ({
        connect: connectMock,
        mailboxOpen: openMock,
        fetch: vi.fn(),
        logout: logoutMock,
        close: closeMock,
        mailbox: { exists: 0 },
      })),
    }));

    const providerStore = await import("@/lib/provider-store");
    const mailboxId = providerStore.saveImapConfig({
      providerId: "outlook",
      account: "user@outlook.com",
      authorizationCode: "auth-code",
      imapHost: "outlook.office365.com",
      imapPort: 993,
    });

    const providerSync = await importProviderSync();
    await providerSync.refreshProvider("outlook", mailboxId, { limit: 10 });

    const openedMailboxes = openMock.mock.calls
      .map((call) => call[0])
      .filter((mailboxName): mailboxName is string => typeof mailboxName === "string");

    expect(openedMailboxes[0]).toBe("INBOX");
    expect(openedMailboxes).toContain("Junk");
    expect(openedMailboxes).toContain("Junk Email");
  });

  it("limits qq imap sync probes to qq-specific mailboxes", async () => {
    vi.resetModules();
    const openMock = vi.fn(async (_mailboxName: string) => ({ exists: 0 }));
    const connectMock = vi.fn(async () => undefined);
    const logoutMock = vi.fn(async () => undefined);
    const closeMock = vi.fn(() => undefined);

    vi.doMock("imapflow", () => ({
      ImapFlow: vi.fn().mockImplementation(() => ({
        connect: connectMock,
        mailboxOpen: openMock,
        fetch: vi.fn(),
        logout: logoutMock,
        close: closeMock,
        mailbox: { exists: 0 },
      })),
    }));

    const providerStore = await import("@/lib/provider-store");
    const mailboxId = providerStore.saveImapConfig({
      providerId: "qq",
      account: "user@qq.com",
      authorizationCode: "auth-code",
      imapHost: "imap.qq.com",
      imapPort: 993,
    });

    const providerSync = await importProviderSync();
    await providerSync.refreshProvider("qq", mailboxId, { limit: 10 });

    const openedMailboxes = openMock.mock.calls
      .map((call) => call[0])
      .filter((mailboxName): mailboxName is string => typeof mailboxName === "string");

    expect(openedMailboxes).toEqual(["INBOX", "Junk", "Spam"]);
  });

  it("limits imap total synced messages across mailboxes to the requested count", async () => {
    vi.resetModules();
    const openMock = vi.fn(async (mailboxName: string) => ({ exists: mailboxName === "INBOX" ? 2 : 2 }));
    const connectMock = vi.fn(async () => undefined);
    const logoutMock = vi.fn(async () => undefined);
    const closeMock = vi.fn(() => undefined);
    const fetchMockImap = vi.fn((range: string) => {
      const mailboxName = openMock.mock.calls.at(-1)?.[0];
      async function* items() {
        if (mailboxName === "INBOX") {
          yield {
            uid: 11,
            envelope: { from: [{ address: "one@example.com" }], subject: "One" },
            flags: new Set(),
            internalDate: new Date("2026-06-05T00:00:03.000Z"),
          };
          yield {
            uid: 12,
            envelope: { from: [{ address: "two@example.com" }], subject: "Two" },
            flags: new Set(),
            internalDate: new Date("2026-06-05T00:00:02.000Z"),
          };
          return;
        }

        yield {
          uid: 21,
          envelope: { from: [{ address: "three@example.com" }], subject: "Three" },
          flags: new Set(),
          internalDate: new Date("2026-06-05T00:00:01.000Z"),
        };
        yield {
          uid: 22,
          envelope: { from: [{ address: "four@example.com" }], subject: "Four" },
          flags: new Set(),
          internalDate: new Date("2026-06-05T00:00:00.000Z"),
        };
      }
      return items();
    });

    vi.doMock("imapflow", () => ({
      ImapFlow: vi.fn().mockImplementation(() => ({
        connect: connectMock,
        mailboxOpen: openMock,
        fetch: fetchMockImap,
        logout: logoutMock,
        close: closeMock,
        mailbox: { exists: 2 },
      })),
    }));

    const providerStore = await import("@/lib/provider-store");
    const mailboxId = providerStore.saveImapConfig({
      providerId: "qq",
      account: "user@qq.com",
      authorizationCode: "auth-code",
      imapHost: "imap.qq.com",
      imapPort: 993,
    });

    const providerSync = await importProviderSync();
    const result = await providerSync.refreshProvider("qq", mailboxId, { limit: 3 });

    expect(result).toEqual({ count: 3 });
    expect(providerStore.listMessages().filter((message) => message.mailboxId === mailboxId)).toHaveLength(3);
  });

  it("hydrates imap junk messages from their original mailbox", async () => {
    vi.resetModules();
    const rawMessage = [
      "From: Sender <sender@example.com>",
      "Subject: Junk body",
      "Date: Fri, 05 Jun 2026 00:00:00 +0000",
      "Content-Type: text/html; charset=utf-8",
      "",
      "<p>Spam detail body</p>",
    ].join("\r\n");
    const openMock = vi.fn(async (_mailboxName: string) => ({ exists: 1 }));
    const connectMock = vi.fn(async () => undefined);
    const logoutMock = vi.fn(async () => undefined);
    const closeMock = vi.fn(() => undefined);
    const fetchOneMock = vi.fn(async () => ({
      uid: 42,
      source: Buffer.from(rawMessage),
      flags: new Set(["\\Seen"]),
      internalDate: new Date("2026-06-05T00:00:00.000Z"),
    }));

    vi.doMock("imapflow", () => ({
      ImapFlow: vi.fn().mockImplementation(() => ({
        connect: connectMock,
        mailboxOpen: openMock,
        fetchOne: fetchOneMock,
        logout: logoutMock,
        close: closeMock,
      })),
    }));

    const providerStore = await import("@/lib/provider-store");
    const mailboxId = providerStore.saveImapConfig({
      providerId: "qq",
      account: "user@qq.com",
      authorizationCode: "auth-code",
      imapHost: "imap.qq.com",
      imapPort: 993,
    });
    const messageId = `${mailboxId}-Junk-42`;
    providerStore.upsertMessages(mailboxId, "qq", [{
      id: messageId,
      providerId: "qq",
      mailboxId,
      remoteId: "42",
      remoteFolder: "Junk",
      providerLabel: "QQ Mail",
      from: "sender@example.com",
      subject: "Junk summary",
      preview: "Summary",
      receivedAt: "2026-06-05T00:00:00.000Z",
      unread: true,
      hasAttachments: false,
      tags: [],
      attachments: [],
      text: "",
      html: "",
    }]);

    const providerSync = await importProviderSync();
    await providerSync.hydrateMessageDetail(messageId);

    expect(openMock).toHaveBeenCalledWith("Junk", { readOnly: true });
    expect(fetchOneMock).toHaveBeenCalledWith("42", {
      uid: true,
      source: true,
      envelope: true,
      flags: true,
      internalDate: true,
    }, { uid: true });
    const detail = providerStore.getMessageDetail(messageId);
    expect(detail?.text).toContain("Spam detail body");
    expect(detail?.html).toContain("<p>Spam detail body</p>");
    expect(detail?.unread).toBe(false);
  });

  it("falls back to matching recent imap messages when stored uid detail fetch fails", async () => {
    vi.resetModules();
    const rawMessage = [
      "From: OpenAI <noreply@tm.openai.com>",
      "Subject: 你的临时 ChatGPT 登录代码",
      "Date: Wed, 01 Jul 2026 09:24:00 +0000",
      "Content-Type: text/html; charset=utf-8",
      "",
      "<p>Your temporary ChatGPT code is 123456.</p>",
    ].join("\r\n");
    const openMock = vi.fn(async (_mailboxName: string) => ({ exists: 130 }));
    const connectMock = vi.fn(async () => undefined);
    const logoutMock = vi.fn(async () => undefined);
    const closeMock = vi.fn(() => undefined);
    const fetchOneMock = vi.fn(async () => {
      throw new Error("Command failed");
    });
    const fetchMockImap = vi.fn((_range: string) => {
      async function* items() {
        yield {
          uid: 125,
          source: Buffer.from(rawMessage),
          envelope: {
            from: [{ address: "noreply@tm.openai.com" }],
            subject: "你的临时 ChatGPT 登录代码",
          },
          flags: new Set(["\\Seen"]),
          internalDate: new Date("2026-07-01T09:24:00.000Z"),
        };
      }
      return items();
    });

    vi.doMock("imapflow", () => ({
      ImapFlow: vi.fn().mockImplementation(() => ({
        connect: connectMock,
        mailboxOpen: openMock,
        fetchOne: fetchOneMock,
        fetch: fetchMockImap,
        logout: logoutMock,
        close: closeMock,
        mailbox: { exists: 130 },
      })),
    }));

    const providerStore = await import("@/lib/provider-store");
    const mailboxId = providerStore.saveImapConfig({
      providerId: "outlook",
      account: "user@outlook.com",
      authorizationCode: "auth-code",
      imapHost: "outlook.office365.com",
      imapPort: 993,
    });
    const messageId = `${mailboxId}-INBOX-118`;
    providerStore.upsertMessages(mailboxId, "outlook", [{
      id: messageId,
      providerId: "outlook",
      mailboxId,
      remoteId: "118",
      remoteFolder: "INBOX",
      providerLabel: "Outlook",
      from: "noreply@tm.openai.com",
      subject: "你的临时 ChatGPT 登录代码",
      preview: "你的临时 ChatGPT 登录代码",
      receivedAt: "2026-07-01T09:24:00.000Z",
      unread: true,
      hasAttachments: false,
      tags: [],
      attachments: [],
      text: "",
      html: "",
    }]);

    const providerSync = await importProviderSync();
    await providerSync.hydrateMessageDetail(messageId);

    expect(fetchOneMock).toHaveBeenCalledWith("118", {
      uid: true,
      source: true,
      envelope: true,
      flags: true,
      internalDate: true,
    }, { uid: true });
    expect(fetchMockImap).toHaveBeenCalledWith("81:*", {
      uid: true,
      source: true,
      envelope: true,
      flags: true,
      internalDate: true,
    });
    const detail = providerStore.getMessageDetail(messageId);
    expect(detail?.text).toContain("Your temporary ChatGPT code is 123456.");
    expect(detail?.html).toContain("<p>Your temporary ChatGPT code is 123456.</p>");
    expect(detail?.unread).toBe(false);
  });

  it("hydrates imported outlook imap messages with password when oauth imap connect is rejected", async () => {
    vi.resetModules();
    const rawMessage = [
      "From: OpenAI <noreply@tm.openai.com>",
      "Subject: Outlook password fallback",
      "Date: Wed, 01 Jul 2026 09:24:00 +0000",
      "Content-Type: text/html; charset=utf-8",
      "",
      "<p>Fallback body loaded.</p>",
    ].join("\r\n");
    const tokenClient = {
      connect: vi.fn(async () => {
        throw new Error("Command failed");
      }),
      close: vi.fn(() => undefined),
    };
    const passwordClient = {
      connect: vi.fn(async () => undefined),
      mailboxOpen: vi.fn(async () => ({ exists: 1 })),
      fetchOne: vi.fn(async () => ({
        uid: 42,
        source: Buffer.from(rawMessage),
        envelope: { from: [{ address: "noreply@tm.openai.com" }], subject: "Outlook password fallback" },
        flags: new Set(["\\Seen"]),
        internalDate: new Date("2026-07-01T09:24:00.000Z"),
      })),
      fetch: vi.fn(),
      logout: vi.fn(async () => undefined),
      close: vi.fn(() => undefined),
    };
    const imapFlowMock = vi.fn()
      .mockImplementationOnce(() => tokenClient)
      .mockImplementationOnce(() => passwordClient);

    vi.doMock("imapflow", () => ({
      ImapFlow: imapFlowMock,
    }));

    const providerStore = await import("@/lib/provider-store");
    const imported = providerStore.upsertImportedOutlookMailbox({
      account: "user@outlook.com",
      password: "stored-password",
      clientId: "client-one",
      refreshToken: "refresh-one",
    });
    const messageId = `${imported.mailboxId}-INBOX-42`;
    providerStore.upsertMessages(imported.mailboxId, "outlook", [{
      id: messageId,
      providerId: "outlook",
      mailboxId: imported.mailboxId,
      remoteId: "42",
      remoteFolder: "INBOX",
      providerLabel: "Outlook",
      from: "noreply@tm.openai.com",
      subject: "Outlook password fallback",
      preview: "Outlook password fallback",
      receivedAt: "2026-07-01T09:24:00.000Z",
      unread: true,
      hasAttachments: false,
      tags: [],
      attachments: [],
      text: "",
      html: "",
    }]);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      access_token: "imap-token",
      expires_in: 3600,
      token_type: "Bearer",
    }), { status: 200 }));

    const providerSync = await importProviderSync();
    await providerSync.hydrateMessageDetail(messageId);

    expect(imapFlowMock).toHaveBeenCalledTimes(2);
    expect(imapFlowMock.mock.calls[0]?.[0].auth).toMatchObject({
      user: "user@outlook.com",
      accessToken: "imap-token",
    });
    expect(imapFlowMock.mock.calls[1]?.[0].auth).toMatchObject({
      user: "user@outlook.com",
      pass: "stored-password",
    });
    expect(tokenClient.close).toHaveBeenCalled();
    expect(passwordClient.fetchOne).toHaveBeenCalled();
    const detail = providerStore.getMessageDetail(messageId);
    expect(detail?.html).toContain("<p>Fallback body loaded.</p>");
  });

  it("surfaces imap hydrate failures instead of silently succeeding", async () => {
    vi.resetModules();
    const openMock = vi.fn(async () => ({ exists: 1 }));
    const connectMock = vi.fn(async () => undefined);
    const logoutMock = vi.fn(async () => undefined);
    const closeMock = vi.fn(() => undefined);
    const fetchOneMock = vi.fn(async () => {
      throw new Error("fetch failed");
    });

    vi.doMock("imapflow", () => ({
      ImapFlow: vi.fn().mockImplementation(() => ({
        connect: connectMock,
        mailboxOpen: openMock,
        fetchOne: fetchOneMock,
        logout: logoutMock,
        close: closeMock,
      })),
    }));

    const providerStore = await import("@/lib/provider-store");
    const mailboxId = providerStore.saveImapConfig({
      providerId: "qq",
      account: "user@qq.com",
      authorizationCode: "auth-code",
      imapHost: "imap.qq.com",
      imapPort: 993,
    });
    const messageId = `${mailboxId}-INBOX-42`;
    providerStore.upsertMessages(mailboxId, "qq", [{
      id: messageId,
      providerId: "qq",
      mailboxId,
      remoteId: "42",
      remoteFolder: "INBOX",
      providerLabel: "QQ Mail",
      from: "sender@example.com",
      subject: "Inbox summary",
      preview: "Summary",
      receivedAt: "2026-06-05T00:00:00.000Z",
      unread: true,
      hasAttachments: false,
      tags: [],
      attachments: [],
      text: "",
      html: "",
    }]);

    const providerSync = await importProviderSync();

    await expect(providerSync.hydrateMessageDetail(messageId)).rejects.toThrow(
      "IMAP hydrate failed for qq",
    );
    expect(closeMock).toHaveBeenCalled();
  });
});
