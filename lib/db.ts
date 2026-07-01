import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

let dbInstance: Database.Database | null = null;

export function resolveDbPath() {
  if (process.env.MYMAIL_DB_PATH) {
    return process.env.MYMAIL_DB_PATH;
  }

  if (process.env.MYMAIL_DATA_DIR) {
    return path.join(process.env.MYMAIL_DATA_DIR, "mymail.db");
  }

  if (process.env.NODE_ENV === "test" || process.env.VITEST) {
    return ":memory:";
  }

  return path.join(process.cwd(), "data", "mymail.db");
}

export function getDb() {
  if (dbInstance) return dbInstance;

  const dbPath = resolveDbPath();

  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      account TEXT NOT NULL,
      encrypted_secret TEXT,
      oauth_payload TEXT,
      status TEXT NOT NULL,
      health TEXT NOT NULL,
      last_synced_at TEXT NOT NULL,
      last_error TEXT
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      mailbox_id TEXT NOT NULL DEFAULT '',
      remote_id TEXT,
      remote_folder TEXT,
      from_name TEXT NOT NULL,
      subject TEXT NOT NULL,
      preview TEXT NOT NULL,
      received_at TEXT NOT NULL,
      unread INTEGER NOT NULL,
      has_attachments INTEGER NOT NULL,
      tags TEXT NOT NULL,
      provider_label TEXT NOT NULL DEFAULT '',
      attachments_json TEXT NOT NULL DEFAULT '[]',
      text_content TEXT,
      html_content TEXT,
      locally_read_at TEXT,
      detail_cache TEXT,
      FOREIGN KEY(provider_id) REFERENCES providers(id)
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS run_logs (
      id TEXT PRIMARY KEY,
      at TEXT NOT NULL,
      tone TEXT NOT NULL,
      message TEXT NOT NULL,
      provider TEXT,
      account TEXT
    );
  `);

  const columns = db.prepare("PRAGMA table_info(messages)").all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("provider_label")) {
    db.exec("ALTER TABLE messages ADD COLUMN provider_label TEXT NOT NULL DEFAULT ''");
  }
  if (!columnNames.has("attachments_json")) {
    db.exec("ALTER TABLE messages ADD COLUMN attachments_json TEXT NOT NULL DEFAULT '[]'");
  }
  if (!columnNames.has("text_content")) {
    db.exec("ALTER TABLE messages ADD COLUMN text_content TEXT");
  }
  if (!columnNames.has("html_content")) {
    db.exec("ALTER TABLE messages ADD COLUMN html_content TEXT");
  }
  if (!columnNames.has("locally_read_at")) {
    db.exec("ALTER TABLE messages ADD COLUMN locally_read_at TEXT");
    db.exec("UPDATE messages SET locally_read_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE unread = 0 AND locally_read_at IS NULL");
  }
  if (!columnNames.has("mailbox_id")) {
    db.exec("ALTER TABLE messages ADD COLUMN mailbox_id TEXT NOT NULL DEFAULT ''");
    db.exec("UPDATE messages SET mailbox_id = provider_id WHERE mailbox_id = ''");
  }
  if (!columnNames.has("remote_id")) {
    db.exec("ALTER TABLE messages ADD COLUMN remote_id TEXT");
  }
  if (!columnNames.has("remote_folder")) {
    db.exec("ALTER TABLE messages ADD COLUMN remote_folder TEXT");
  }

  const providerColumns = db.prepare("PRAGMA table_info(providers)").all() as Array<{ name: string }>;
  const providerColumnNames = new Set(providerColumns.map((column) => column.name));
  if (!providerColumnNames.has("provider_id")) {
    db.exec("ALTER TABLE providers ADD COLUMN provider_id TEXT NOT NULL DEFAULT ''");
    db.exec("UPDATE providers SET provider_id = id WHERE provider_id = ''");
  }

  dbInstance = db;
  return dbInstance;
}
