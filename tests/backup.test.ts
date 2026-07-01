import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { setAutoSyncFetchLimit, setNotificationsEnabled, setRefreshIntervalSeconds } from "@/lib/app-settings";
import { saveImapConfig, saveOAuthConfig, upsertMessages } from "@/lib/provider-store";

describe("backup payloads", () => {
  beforeEach(() => {
    const db = getDb();
    db.prepare("DELETE FROM messages").run();
    db.prepare("DELETE FROM providers").run();
    db.prepare("DELETE FROM app_settings").run();
    process.env.MYMAIL_GMAIL_CLIENT_ID = "test-gmail-client";
    process.env.MYMAIL_GMAIL_CLIENT_SECRET = "test-gmail-secret";
    process.env.MYMAIL_OUTLOOK_CLIENT_ID = "test-outlook-client";
    process.env.MYMAIL_OUTLOOK_CLIENT_SECRET = "test-outlook-secret";
  });

  it("exports app settings, providers, and messages in a versioned payload", async () => {
    const { buildBackupPayload } = await import("@/lib/backup");

    setRefreshIntervalSeconds(300);
    setNotificationsEnabled(true);
    setAutoSyncFetchLimit(12);
    const mailboxId = saveImapConfig({
      providerId: "qq",
      account: "user@qq.com",
      authorizationCode: "auth-code",
      imapHost: "imap.qq.com",
      imapPort: 993,
      syncFetchLimit: 21,
    });

    upsertMessages(mailboxId, "qq", [{
      id: "message-1",
      providerId: "qq",
      mailboxId,
      from: "Sender",
      subject: "Backup subject",
      preview: "Backup preview",
      receivedAt: "2026-06-11T10:00:00.000Z",
      unread: true,
      hasAttachments: false,
      tags: ["inbox"],
      attachments: [],
      providerLabel: "QQ Mail",
      text: "Body",
      html: "<p>Body</p>",
    }]);

    const payload = buildBackupPayload();

    expect(payload.version).toBe(1);
    expect(payload.appSettings.length).toBeGreaterThan(0);
    expect(payload.providers.some((row) => row.id === mailboxId)).toBe(true);
    expect(payload.messages.some((row) => row.id === "message-1")).toBe(true);
  });

  it("replaces existing data when importing in replace mode", async () => {
    const { importBackupPayload, parseBackupPayload } = await import("@/lib/backup");

    const payload = parseBackupPayload({
      version: 1,
      exportedAt: "2026-06-11T10:00:00.000Z",
      appSettings: [{ key: "refresh_interval_seconds", value: "600", updated_at: "2026-06-11T10:00:00.000Z" }],
      providers: [
        {
          id: "gmail",
          provider_id: "gmail",
          mode: "oauth",
          account: "未连接",
          encrypted_secret: null,
          oauth_payload: "{\"tenantId\":\"common\"}",
          status: "disconnected",
          health: "healthy",
          last_synced_at: "未同步",
          last_error: null,
        },
        {
          id: "gmail-box-1",
          provider_id: "gmail",
          mode: "oauth",
          account: "user@gmail.com",
          encrypted_secret: null,
          oauth_payload: "{\"tenantId\":\"common\"}",
          status: "connected",
          health: "healthy",
          last_synced_at: "2026-06-11T10:00:00.000Z",
          last_error: null,
        },
      ],
      messages: [{
        id: "message-1",
        provider_id: "gmail",
        mailbox_id: "gmail-box-1",
        remote_id: null,
        remote_folder: null,
        from_name: "Sender",
        subject: "Imported",
        preview: "Imported preview",
        received_at: "2026-06-11T10:00:00.000Z",
        unread: 1,
        has_attachments: 0,
        tags: "[]",
        provider_label: "Gmail",
        attachments_json: "[]",
        text_content: "Body",
        html_content: "<p>Body</p>",
        locally_read_at: null,
      }],
    });

    saveOAuthConfig({ providerId: "outlook", account: "old@outlook.com" });

    const summary = importBackupPayload(payload, "replace");
    const db = getDb();

    expect(summary.mode).toBe("replace");
    expect((db.prepare("SELECT COUNT(*) AS count FROM providers").get() as { count: number }).count).toBe(2);
    expect((db.prepare("SELECT account FROM providers WHERE id = ?").get("gmail-box-1") as { account: string }).account).toBe("user@gmail.com");
  });

  it("merges imported rows by primary key", async () => {
    const { importBackupPayload, parseBackupPayload } = await import("@/lib/backup");

    saveOAuthConfig({ providerId: "gmail", mailboxId: "gmail-box-1", account: "old@gmail.com" });
    const payload = parseBackupPayload({
      version: 1,
      exportedAt: "2026-06-11T10:00:00.000Z",
      appSettings: [{ key: "browser_notifications_enabled", value: "1", updated_at: "2026-06-11T10:00:00.000Z" }],
      providers: [{
        id: "gmail-box-1",
        provider_id: "gmail",
        mode: "oauth",
        account: "new@gmail.com",
        encrypted_secret: null,
        oauth_payload: "{\"tenantId\":\"common\"}",
        status: "connected",
        health: "healthy",
        last_synced_at: "2026-06-11T10:00:00.000Z",
        last_error: null,
      }],
      messages: [],
    });

    const summary = importBackupPayload(payload, "merge");
    const db = getDb();

    expect(summary.mode).toBe("merge");
    expect((db.prepare("SELECT account FROM providers WHERE id = ?").get("gmail-box-1") as { account: string }).account).toBe("new@gmail.com");
  });

  it("rejects unsupported versions", async () => {
    const { parseBackupPayload } = await import("@/lib/backup");

    expect(() => parseBackupPayload({
      version: 99,
      exportedAt: "2026-06-11T10:00:00.000Z",
      appSettings: [],
      providers: [],
      messages: [],
    })).toThrow("不支持的备份版本");
  });
});
