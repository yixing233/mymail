import { z } from "zod";
import { getDb } from "@/lib/db";

const providerIdSchema = z.enum(["gmail", "outlook", "qq", "mail163"]);
const modeSchema = z.enum(["oauth", "imap"]);
const providerStatusSchema = z.enum(["connected", "degraded", "disconnected", "reauth"]);
const syncHealthSchema = z.enum(["healthy", "rate_limited", "offline", "auth_expired", "error"]);

const appSettingRowSchema = z.object({
  key: z.string(),
  value: z.string(),
  updated_at: z.string(),
});

const providerRowSchema = z.object({
  id: z.string(),
  provider_id: providerIdSchema,
  mode: modeSchema,
  account: z.string(),
  encrypted_secret: z.string().nullable(),
  oauth_payload: z.string().nullable(),
  status: providerStatusSchema,
  health: syncHealthSchema,
  last_synced_at: z.string(),
  last_error: z.string().nullable(),
});

const messageRowSchema = z.object({
  id: z.string(),
  provider_id: providerIdSchema,
  mailbox_id: z.string(),
  remote_id: z.string().nullable(),
  remote_folder: z.string().nullable(),
  from_name: z.string(),
  subject: z.string(),
  preview: z.string(),
  received_at: z.string(),
  unread: z.number().int(),
  has_attachments: z.number().int(),
  tags: z.string(),
  provider_label: z.string(),
  attachments_json: z.string(),
  text_content: z.string().nullable(),
  html_content: z.string().nullable(),
  locally_read_at: z.string().nullable(),
});

const backupPayloadSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string(),
  appSettings: z.array(appSettingRowSchema),
  providers: z.array(providerRowSchema),
  messages: z.array(messageRowSchema),
});

export type BackupPayload = z.infer<typeof backupPayloadSchema>;
export type BackupImportMode = "replace" | "merge";

export function parseBackupPayload(input: unknown): BackupPayload {
  const version = typeof input === "object" && input !== null && "version" in input
    ? Reflect.get(input, "version")
    : undefined;

  if (version !== 1) {
    throw new Error("不支持的备份版本");
  }

  const parsed = backupPayloadSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("备份文件格式无效");
  }

  return parsed.data;
}

export function buildBackupPayload(): BackupPayload {
  const db = getDb();

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    appSettings: db
      .prepare("SELECT key, value, updated_at FROM app_settings ORDER BY key")
      .all() as BackupPayload["appSettings"],
    providers: db
      .prepare(`
        SELECT id, provider_id, mode, account, encrypted_secret, oauth_payload, status, health, last_synced_at, last_error
        FROM providers
        ORDER BY provider_id, id
      `)
      .all() as BackupPayload["providers"],
    messages: db
      .prepare(`
        SELECT id, provider_id, mailbox_id, remote_id, remote_folder, from_name, subject, preview, received_at, unread,
               has_attachments, tags, provider_label, attachments_json, text_content, html_content, locally_read_at
        FROM messages
        ORDER BY datetime(received_at) DESC, id DESC
      `)
      .all() as BackupPayload["messages"],
  };
}

export function importBackupPayload(payload: BackupPayload, mode: BackupImportMode) {
  const db = getDb();

  const writeAll = db.transaction(() => {
    if (mode === "replace") {
      db.prepare("DELETE FROM messages").run();
      db.prepare("DELETE FROM providers").run();
      db.prepare("DELETE FROM app_settings").run();
    }

    const upsertAppSetting = db.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (@key, @value, @updated_at)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);

    const upsertProvider = db.prepare(`
      INSERT INTO providers (id, provider_id, mode, account, encrypted_secret, oauth_payload, status, health, last_synced_at, last_error)
      VALUES (@id, @provider_id, @mode, @account, @encrypted_secret, @oauth_payload, @status, @health, @last_synced_at, @last_error)
      ON CONFLICT(id) DO UPDATE SET
        provider_id = excluded.provider_id,
        mode = excluded.mode,
        account = excluded.account,
        encrypted_secret = excluded.encrypted_secret,
        oauth_payload = excluded.oauth_payload,
        status = excluded.status,
        health = excluded.health,
        last_synced_at = excluded.last_synced_at,
        last_error = excluded.last_error
    `);

    const upsertMessage = db.prepare(`
      INSERT INTO messages (
        id, provider_id, mailbox_id, remote_id, remote_folder, from_name, subject, preview, received_at, unread,
        has_attachments, tags, provider_label, attachments_json, text_content, html_content, locally_read_at, detail_cache
      ) VALUES (
        @id, @provider_id, @mailbox_id, @remote_id, @remote_folder, @from_name, @subject, @preview, @received_at, @unread,
        @has_attachments, @tags, @provider_label, @attachments_json, @text_content, @html_content, @locally_read_at, NULL
      )
      ON CONFLICT(id) DO UPDATE SET
        provider_id = excluded.provider_id,
        mailbox_id = excluded.mailbox_id,
        remote_id = excluded.remote_id,
        remote_folder = excluded.remote_folder,
        from_name = excluded.from_name,
        subject = excluded.subject,
        preview = excluded.preview,
        received_at = excluded.received_at,
        unread = excluded.unread,
        has_attachments = excluded.has_attachments,
        tags = excluded.tags,
        provider_label = excluded.provider_label,
        attachments_json = excluded.attachments_json,
        text_content = excluded.text_content,
        html_content = excluded.html_content,
        locally_read_at = excluded.locally_read_at
    `);

    payload.appSettings.forEach((row) => upsertAppSetting.run(row));
    payload.providers.forEach((row) => upsertProvider.run(row));
    payload.messages.forEach((row) => upsertMessage.run(row));
  });

  writeAll();

  return {
    success: true,
    mode,
    appSettingsCount: payload.appSettings.length,
    providersCount: payload.providers.length,
    messagesCount: payload.messages.length,
  };
}
