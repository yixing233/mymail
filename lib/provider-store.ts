import { defaultSourceConfigs, providerScopes } from "@/lib/data";
import { getDb } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/security";
import type {
  MailAttachment,
  MailDetail,
  MailMailbox,
  MailMessage,
  MailProviderGroup,
  MailSourceConfig,
  OutlookSyncMode,
  ProviderId,
  ProviderStatus,
  SyncHealth,
  SyncMode,
} from "@/lib/types";

interface ProviderRow {
  id: string;
  provider_id: ProviderId;
  mode: SyncMode;
  account: string;
  encrypted_secret: string | null;
  oauth_payload: string | null;
  status: ProviderStatus;
  health: SyncHealth;
  last_synced_at: string;
  last_error: string | null;
}

interface MessageRow {
  id: string;
  provider_id: ProviderId;
  mailbox_id: string;
  remote_id: string | null;
  remote_folder: string | null;
  from_name: string;
  subject: string;
  preview: string;
  received_at: string;
  unread: number;
  has_attachments: number;
  tags: string;
  provider_label: string;
  attachments_json: string;
  text_content: string | null;
  html_content: string | null;
  locally_read_at: string | null;
}

interface StoredSecrets {
  clientSecret?: string;
  password?: string;
  authorizationCode?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenType?: string;
  expiryDate?: number;
}

interface StoredPayload {
  clientId?: string;
  tenantId?: string;
  scopes?: string[];
  imapHost?: string;
  imapPort?: number;
  outlookSyncMode?: OutlookSyncMode;
  syncFetchLimit?: number;
}

function getBuiltinOAuthConfig(providerId: ProviderId): Pick<StoredPayload, "clientId"> & Pick<StoredSecrets, "clientSecret"> {
  if (providerId === "outlook") {
    return {
      clientId: process.env.MYMAIL_OUTLOOK_CLIENT_ID,
      clientSecret: process.env.MYMAIL_OUTLOOK_CLIENT_SECRET,
    };
  }

  if (providerId === "gmail") {
    return {
      clientId: process.env.MYMAIL_GMAIL_CLIENT_ID,
      clientSecret: process.env.MYMAIL_GMAIL_CLIENT_SECRET,
    };
  }

  return {};
}

interface ProviderGroupRow {
  provider_id: ProviderId;
  mode: SyncMode;
  account: string;
  encrypted_secret: string | null;
  oauth_payload: string | null;
  status: ProviderStatus;
  health: SyncHealth;
  last_synced_at: string;
  last_error: string | null;
}

const providerMeta: Record<
  ProviderId,
  { label: string; accent: string; authHint: string }
> = {
  gmail: { label: "Gmail", accent: "var(--gmail)", authHint: "Google OAuth" },
  outlook: { label: "Outlook", accent: "var(--outlook)", authHint: "Microsoft OAuth" },
  qq: { label: "QQ Mail", accent: "var(--qq)", authHint: "IMAP + 授权码" },
  mail163: { label: "163 Mail", accent: "var(--mail163)", authHint: "IMAP + 客户端授权码" },
};

function createMailboxId(providerId: ProviderId) {
  return `${providerId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getProviderMeta(providerId: ProviderId) {
  return providerMeta[providerId];
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function linkifyPlainText(value: string) {
  const urlPattern = /https?:\/\/[^\s<>"')]+/gi;
  return escapeHtml(value).replace(urlPattern, (url) => {
    const normalizedUrl = url.replace(/[),.;:!?]+$/g, "");
    const trailing = url.slice(normalizedUrl.length);
    return `<a href="${normalizedUrl}" target="_blank" rel="noopener noreferrer">${normalizedUrl}</a>${trailing}`;
  });
}

export function renderTextFallback(text: string) {
  const normalized = text.trim() || "暂无邮件内容";
  const paragraphs = normalized
    .split(/\r?\n\r?\n+/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${linkifyPlainText(block).replace(/\r?\n/g, "<br />")}</p>`);
  return `<div>${paragraphs.join("")}</div>`;
}

function forceExternalLinksToNewTab(html: string) {
  return html.replace(/<a\b([^>]*)>/gi, (_match, attributes: string) => {
    let nextAttributes = String(attributes)
      .replace(/\s+target\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, "")
      .replace(/\s+rel\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, "");

    nextAttributes = `${nextAttributes} target="_blank" rel="noopener noreferrer"`;
    return `<a${nextAttributes}>`;
  });
}

function unwrapPlainTextWrapperHtml(html: string) {
  const match = html.match(/^<div>\s*<p>([\s\S]*)<\/p>\s*<\/div>$/i);
  if (!match?.[1]) {
    return null;
  }

  const inner = match[1];
  if (/<[a-z!/][^>]*>/i.test(inner)) {
    return null;
  }

  return inner;
}

function getOriginalEmailHtml(html: string | null, fallbackText: string) {
  const normalizedHtml = html?.trim();
  if (!normalizedHtml || normalizedHtml === "false") {
    return renderTextFallback(fallbackText);
  }

  const wrappedPlainText = unwrapPlainTextWrapperHtml(normalizedHtml);
  if (wrappedPlainText) {
    return renderTextFallback(wrappedPlainText);
  }

  if (!/<[a-z!/][^>]*>/i.test(normalizedHtml)) {
    return renderTextFallback(fallbackText);
  }

  const originalHtml = normalizedHtml;
  const textOnly = originalHtml.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  const hasRenderableMedia = /<(img|table|svg|video)\b/i.test(originalHtml);
  if (!originalHtml || (!textOnly && !hasRenderableMedia)) {
    return renderTextFallback(fallbackText);
  }

  return forceExternalLinksToNewTab(originalHtml);
}

export interface ProviderFormState {
  providerId: ProviderId;
  mailboxId?: string;
  mode: SyncMode;
  account: string;
  authState: ProviderStatus;
  syncHealth: SyncHealth;
  lastSyncedAt: string;
  lastError?: string;
  tenantId?: string;
  imapHost?: string;
  imapPort?: number;
  hasSecret: boolean;
  hasRefreshToken: boolean;
  authorizationCode?: string;
  syncFetchLimit?: number;
}

export interface ProviderTokenState {
  accessToken?: string;
  refreshToken?: string;
  tokenType?: string;
  expiryDate?: number;
  password?: string;
}

function isConfiguredAccount(account: string) {
  return Boolean(account && account !== "未连接");
}

function getDefaultConfig(providerId: ProviderId) {
  const config = defaultSourceConfigs.find((item) => item.providerId === providerId);
  if (!config) {
    throw new Error(`Provider not found: ${providerId}`);
  }
  return config;
}

function buildBlankProviderFormState(providerId: ProviderId): ProviderFormState {
  const config = getDefaultConfig(providerId);
  const builtin = getBuiltinOAuthConfig(providerId);
  return {
    providerId,
    mode: config.mode,
    account: "",
    authState: "disconnected",
    syncHealth: "healthy",
    lastSyncedAt: "未同步",
    tenantId: "common",
    imapHost: config.imapHost,
    imapPort: config.imapPort,
    hasSecret: Boolean(builtin.clientSecret),
    hasRefreshToken: false,
    syncFetchLimit: undefined,
  };
}

function parsePayload(payload: string | null): StoredPayload {
  if (!payload) return {};
  try {
    return JSON.parse(payload) as StoredPayload;
  } catch {
    return {};
  }
}

function parseSecrets(encrypted: string | null): StoredSecrets {
  if (!encrypted) return {};
  try {
    return JSON.parse(decryptSecret(encrypted)) as StoredSecrets;
  } catch {
    return {};
  }
}

function resolveStoredMode(row: ProviderRow, payload: StoredPayload, secrets: StoredSecrets, builtinClientId?: string): SyncMode {
  return row.mode;
}

export interface ProviderFormState {
  providerId: ProviderId;
  mailboxId?: string;
  mode: SyncMode;
  account: string;
  authState: ProviderStatus;
  syncHealth: SyncHealth;
  lastSyncedAt: string;
  lastError?: string;
  tenantId?: string;
  imapHost?: string;
  imapPort?: number;
  hasSecret: boolean;
  hasRefreshToken: boolean;
  authorizationCode?: string;
}

export interface ProviderTokenState {
  accessToken?: string;
  refreshToken?: string;
  tokenType?: string;
  expiryDate?: number;
  password?: string;
}

function serializeSecrets(input: StoredSecrets) {
  const normalized = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== ""),
  );
  return Object.keys(normalized).length ? encryptSecret(JSON.stringify(normalized)) : null;
}

function ensureSeeded() {
  const db = getDb();
  const count = db.prepare("SELECT COUNT(*) AS count FROM providers").get() as { count: number };
  if (count.count > 0) return;

  const insert = db.prepare(`
    INSERT INTO providers (id, provider_id, mode, account, encrypted_secret, oauth_payload, status, health, last_synced_at, last_error)
    VALUES (@id, @provider_id, @mode, @account, NULL, @oauth_payload, @status, @health, @last_synced_at, NULL)
  `);

  const insertMany = db.transaction((configs: MailSourceConfig[]) => {
    for (const config of configs) {
      const payload =
        config.mode === "oauth"
          ? { scopes: providerScopes[config.providerId], tenantId: "common" }
          : { imapHost: config.imapHost, imapPort: config.imapPort };

      insert.run({
        id: config.providerId,
        provider_id: config.providerId,
        mode: config.mode,
        account: config.account,
        oauth_payload: JSON.stringify(payload),
        status: config.authState,
        health: config.syncHealth,
        last_synced_at: config.lastSyncedAt,
      });
    }
  });

  insertMany(defaultSourceConfigs);
}

function rowToMailbox(row: ProviderRow): MailMailbox {
  const payload = parsePayload(row.oauth_payload);
  return {
    id: row.id,
    providerId: row.provider_id,
    account: row.account,
    status: row.status,
    health: row.health,
    unreadCount: 0,
    lastSyncedAt: row.last_synced_at,
    lastError: row.last_error ?? undefined,
    syncFetchLimit: payload.syncFetchLimit,
  };
}

function mapGroupRow(row: ProviderGroupRow): MailProviderGroup {
  const meta = getProviderMeta(row.provider_id);
  return {
    id: row.provider_id,
    label: meta.label,
    mode: row.mode,
    unreadCount: 0,
    lastSyncedAt: row.last_synced_at,
    lastError: row.last_error ?? undefined,
    accent: meta.accent,
    authHint: meta.authHint,
    mailboxes: [],
  };
}

export function listProviderConfigs(): MailProviderGroup[] {
  ensureSeeded();
  const db = getDb();
  const rows = db.prepare("SELECT * FROM providers ORDER BY provider_id, id").all() as ProviderRow[];
  const unreadRows = db
    .prepare("SELECT mailbox_id, provider_id, COUNT(*) AS unread FROM messages WHERE unread = 1 GROUP BY mailbox_id, provider_id")
    .all() as Array<{ mailbox_id: string; provider_id: ProviderId; unread: number }>;
  const unreadByMailbox = new Map<string, number>();
  const unreadByProvider = new Map<ProviderId, number>();
  for (const row of unreadRows) {
    unreadByMailbox.set(row.mailbox_id || row.provider_id, row.unread);
    unreadByProvider.set(row.provider_id, (unreadByProvider.get(row.provider_id) ?? 0) + row.unread);
  }
  const groups = new Map<ProviderId, MailProviderGroup>();

  for (const row of rows) {
    const group = groups.get(row.provider_id) ?? (() => {
      const created = mapGroupRow(row as ProviderGroupRow);
      groups.set(row.provider_id, created);
      return created;
    })();
    if (isConfiguredAccount(row.account)) {
      const mailbox = rowToMailbox(row);
      mailbox.unreadCount = unreadByMailbox.get(mailbox.id) ?? 0;
      group.mailboxes.push(mailbox);
    }
    group.unreadCount = unreadByProvider.get(row.provider_id) ?? group.unreadCount;
  }

  return [...groups.values()];
}

export function listProviderMailboxes(providerId: ProviderId): MailMailbox[] {
  ensureSeeded();
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM providers WHERE provider_id = ? AND account != '未连接' ORDER BY id")
    .all(providerId) as ProviderRow[];
  return rows.map(rowToMailbox);
}

function getProviderRow(providerId: ProviderId) {
  const db = getDb();
  return db
    .prepare("SELECT * FROM providers WHERE provider_id = ? AND account != '未连接' ORDER BY last_synced_at DESC, id DESC LIMIT 1")
    .get(providerId) as ProviderRow | undefined;
}

export function getProviderConfig(providerId: ProviderId): MailSourceConfig {
  ensureSeeded();
  const row = getProviderRow(providerId);
  if (!row) {
    throw new Error(`Provider not found: ${providerId}`);
  }
  const payload = parsePayload(row.oauth_payload);
  const secrets = parseSecrets(row.encrypted_secret);
  const builtin = getBuiltinOAuthConfig(providerId);
  const mode = resolveStoredMode(row, payload, secrets, builtin.clientId);
  return {
    providerId,
    mode,
    account: row.account,
    oauthConnected: row.status === "connected",
    imapHost: payload.imapHost,
    imapPort: payload.imapPort,
    authState: row.status,
    syncHealth: row.health,
    lastSyncedAt: row.last_synced_at,
    lastError: row.last_error ?? undefined,
    syncFetchLimit: payload.syncFetchLimit,
  };
}

export function getMailboxConfig(providerId: ProviderId, mailboxId: string): MailSourceConfig {
  ensureSeeded();
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM providers WHERE id = ? AND provider_id = ?")
    .get(mailboxId, providerId) as ProviderRow | undefined;
  if (!row) {
    throw new Error(`Mailbox not found: ${mailboxId}`);
  }
  const payload = parsePayload(row.oauth_payload);
  const secrets = parseSecrets(row.encrypted_secret);
  const builtin = getBuiltinOAuthConfig(providerId);
  const mode = resolveStoredMode(row, payload, secrets, builtin.clientId);
  return {
    providerId,
    mode,
    account: row.account,
    oauthConnected: row.status === "connected",
    imapHost: payload.imapHost,
    imapPort: payload.imapPort,
    authState: row.status,
    syncHealth: row.health,
    lastSyncedAt: row.last_synced_at,
    lastError: row.last_error ?? undefined,
    syncFetchLimit: payload.syncFetchLimit,
  };
}

export function getProviderFormState(providerId: ProviderId, mailboxId?: string): ProviderFormState {
  ensureSeeded();
  const db = getDb();
  const row = mailboxId
    ? (db.prepare("SELECT * FROM providers WHERE id = ? AND provider_id = ?").get(mailboxId, providerId) as ProviderRow | undefined)
    : getProviderRow(providerId);
  if (!row) {
    return buildBlankProviderFormState(providerId);
  }

  const payload = parsePayload(row.oauth_payload);
  const secrets = parseSecrets(row.encrypted_secret);
  const builtin = getBuiltinOAuthConfig(providerId);
  const mode = resolveStoredMode(row, payload, secrets, builtin.clientId);

  return {
    providerId,
    mailboxId: row.id,
    mode,
    account: row.account === "未连接" ? "" : row.account,
    authState: row.status,
    syncHealth: row.health,
    lastSyncedAt: row.last_synced_at,
    lastError: row.last_error ?? undefined,
    tenantId: payload.tenantId ?? "common",
    imapHost: payload.imapHost,
    imapPort: payload.imapPort,
    hasSecret: mode === "oauth" ? Boolean(builtin.clientSecret) : Boolean(secrets.authorizationCode || secrets.password),
    hasRefreshToken: Boolean(secrets.refreshToken),
    authorizationCode: mode === "imap" ? (secrets.authorizationCode ?? secrets.password) : undefined,
    syncFetchLimit: payload.syncFetchLimit,
  };
}

export function getProviderTokens(providerId: ProviderId, mailboxId?: string): ProviderTokenState {
  if (providerId !== "gmail" && providerId !== "outlook") {
    throw new Error("OAuth tokens only");
  }

  if (!mailboxId) {
    throw new Error("Mailbox id is required for OAuth tokens");
  }

  ensureSeeded();
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM providers WHERE id = ? AND provider_id = ?")
    .get(mailboxId, providerId) as ProviderRow | undefined;
  if (!row) {
    throw new Error(`Provider not found: ${providerId}`);
  }

  const secrets = parseSecrets(row.encrypted_secret);
  return {
    accessToken: secrets.accessToken,
    refreshToken: secrets.refreshToken,
    tokenType: secrets.tokenType,
    expiryDate: secrets.expiryDate,
    password: secrets.password,
  };
}

export function saveOAuthConfig(input: {
  providerId: ProviderId;
  mailboxId?: string;
  account: string;
  tenantId?: string;
  outlookSyncMode?: OutlookSyncMode;
  imapHost?: string;
  imapPort?: number;
  clientId?: string;
  syncFetchLimit?: number;
}) {
  ensureSeeded();
  const db = getDb();
  const builtin = getBuiltinOAuthConfig(input.providerId);
  if (!builtin.clientId) {
    throw new Error("缺少 .env OAuth Client ID");
  }
  if (!builtin.clientSecret) {
    throw new Error("缺少 .env OAuth Client Secret");
  }
  const row = input.mailboxId
    ? (db.prepare("SELECT * FROM providers WHERE id = ? AND provider_id = ?").get(input.mailboxId, input.providerId) as ProviderRow | undefined)
    : undefined;
  if (!row) {
    const mailboxId = input.mailboxId || createMailboxId(input.providerId);
    db.prepare(`
      INSERT INTO providers (id, provider_id, mode, account, encrypted_secret, oauth_payload, status, health, last_synced_at, last_error)
      VALUES (@id, @provider_id, 'oauth', @account, @encrypted_secret, @oauth_payload, 'disconnected', 'healthy', @last_synced_at, NULL)
    `).run({
      id: mailboxId,
      provider_id: input.providerId,
      account: input.account || "未连接",
      oauth_payload: JSON.stringify({
        clientId: input.clientId,
        tenantId: input.tenantId ?? "common",
        scopes: providerScopes[input.providerId],
        outlookSyncMode: input.outlookSyncMode,
        imapHost: input.imapHost,
        imapPort: input.imapPort,
        syncFetchLimit: input.syncFetchLimit,
      }),
      encrypted_secret: null,
      last_synced_at: "未同步",
    });
    return mailboxId;
  }
  const existingSecrets = parseSecrets(row.encrypted_secret);
  const nextSecrets: StoredSecrets = {
    ...existingSecrets,
    clientSecret: undefined,
  };

  db.prepare(`
    UPDATE providers
    SET mode = 'oauth',
        account = @account,
        oauth_payload = @oauth_payload,
        encrypted_secret = @encrypted_secret,
        last_error = NULL
    WHERE id = @id
  `).run({
    id: row.id,
    account: input.account || "未连接",
    oauth_payload: JSON.stringify({
      clientId: input.clientId,
      tenantId: input.tenantId ?? "common",
      scopes: providerScopes[input.providerId],
      outlookSyncMode: input.outlookSyncMode,
      imapHost: input.imapHost,
      imapPort: input.imapPort,
      syncFetchLimit: input.syncFetchLimit,
    }),
    encrypted_secret: serializeSecrets(nextSecrets),
  });
  return row.id;
}

export function saveImapConfig(input: {
  providerId: ProviderId;
  mailboxId?: string;
  account: string;
  authorizationCode?: string;
  imapHost: string;
  imapPort: number;
  syncFetchLimit?: number;
}) {
  ensureSeeded();
  const db = getDb();
  const row = input.mailboxId
    ? (db.prepare("SELECT * FROM providers WHERE id = ? AND provider_id = ?").get(input.mailboxId, input.providerId) as ProviderRow | undefined)
    : undefined;
  if (!row) {
    const mailboxId = input.mailboxId || createMailboxId(input.providerId);
    db.prepare(`
      INSERT INTO providers (id, provider_id, mode, account, encrypted_secret, oauth_payload, status, health, last_synced_at, last_error)
      VALUES (@id, @provider_id, 'imap', @account, @encrypted_secret, @oauth_payload, 'disconnected', 'healthy', @last_synced_at, NULL)
    `).run({
      id: mailboxId,
      provider_id: input.providerId,
      account: input.account || "未连接",
      oauth_payload: JSON.stringify({
        imapHost: input.imapHost,
        imapPort: input.imapPort,
        syncFetchLimit: input.syncFetchLimit,
      }),
      encrypted_secret: serializeSecrets({ authorizationCode: input.authorizationCode }),
      last_synced_at: "未同步",
    });
    return mailboxId;
  }
  const existingSecrets = parseSecrets(row.encrypted_secret);
  const nextSecrets: StoredSecrets = {
    ...existingSecrets,
    authorizationCode: input.authorizationCode || existingSecrets.authorizationCode,
  };

  db.prepare(`
    UPDATE providers
    SET mode = 'imap',
        account = @account,
        oauth_payload = @oauth_payload,
        encrypted_secret = @encrypted_secret,
        status = 'disconnected',
        health = 'healthy',
        last_error = NULL
    WHERE id = @id
  `).run({
    id: row.id,
    account: input.account || "未连接",
    oauth_payload: JSON.stringify({
      imapHost: input.imapHost,
      imapPort: input.imapPort,
      syncFetchLimit: input.syncFetchLimit,
    }),
    encrypted_secret: serializeSecrets(nextSecrets),
  });
  return row.id;
}

export function updateProviderConnectionState(input: {
  providerId: ProviderId;
  mailboxId?: string;
  account?: string;
  status: ProviderStatus;
  health: SyncHealth;
  lastSyncedAt: string;
  lastError?: string | null;
  tokenPayload?: {
    accessToken?: string;
    refreshToken?: string;
    tokenType?: string;
    expiryDate?: number;
  };
}) {
  ensureSeeded();
  const db = getDb();
  const row = input.mailboxId
    ? (db.prepare("SELECT * FROM providers WHERE id = ? AND provider_id = ?").get(input.mailboxId, input.providerId) as ProviderRow | undefined)
    : getProviderRow(input.providerId);
  if (!row) {
    throw new Error(`Provider not found: ${input.providerId}`);
  }
  const existingSecrets = parseSecrets(row.encrypted_secret);
  const definedTokenPayload = input.tokenPayload
    ? Object.fromEntries(
        Object.entries(input.tokenPayload).filter(([, value]) => value !== undefined && value !== ""),
      )
    : {};
  const nextSecrets: StoredSecrets = {
    ...existingSecrets,
    ...definedTokenPayload,
  };
  if (input.providerId === "gmail" || input.providerId === "outlook") {
    nextSecrets.clientSecret = undefined;
  }

  db.prepare(`
    UPDATE providers
    SET account = @account,
        encrypted_secret = @encrypted_secret,
        status = @status,
        health = @health,
        last_synced_at = @last_synced_at,
        last_error = @last_error
    WHERE id = @id
  `).run({
    id: row.id,
    account: input.account ?? row.account,
    encrypted_secret: serializeSecrets(nextSecrets),
    status: input.status,
    health: input.health,
    last_synced_at: input.lastSyncedAt,
    last_error: input.lastError ?? null,
  });
}

export function getProviderSecrets(providerId: ProviderId, mailboxId?: string): StoredSecrets {
  ensureSeeded();
  const db = getDb();
  const builtin = getBuiltinOAuthConfig(providerId);
  const row = mailboxId
    ? (db.prepare("SELECT * FROM providers WHERE id = ? AND provider_id = ?").get(mailboxId, providerId) as ProviderRow | undefined)
    : getProviderRow(providerId);
  if (!row) return builtin;
  const stored = parseSecrets(row.encrypted_secret);
  if (providerId === "gmail") {
    return { ...stored, clientSecret: builtin.clientSecret };
  }
  if (providerId === "outlook") {
    const payload = parsePayload(row.oauth_payload);
    const usesBuiltinClient = !payload.clientId || payload.clientId === builtin.clientId;
    return { ...stored, clientSecret: usesBuiltinClient ? builtin.clientSecret : stored.clientSecret };
  }
  return stored;
}

export function getProviderPayload(providerId: ProviderId, mailboxId?: string): StoredPayload {
  ensureSeeded();
  const db = getDb();
  const builtin = getBuiltinOAuthConfig(providerId);
  const row = mailboxId
    ? (db.prepare("SELECT * FROM providers WHERE id = ? AND provider_id = ?").get(mailboxId, providerId) as ProviderRow | undefined)
    : getProviderRow(providerId);
  if (!row) return builtin;
  const payload = parsePayload(row.oauth_payload);
  if (providerId === "gmail" || providerId === "outlook") {
    return { ...payload, clientId: payload.clientId ?? builtin.clientId };
  }
  return payload;
}

export function upsertImportedOutlookMailbox(input: {
  account: string;
  password: string;
  clientId: string;
  refreshToken: string;
}) {
  ensureSeeded();
  const db = getDb();
  const existing = db
    .prepare("SELECT * FROM providers WHERE provider_id = 'outlook' AND LOWER(account) = LOWER(?) ORDER BY id LIMIT 1")
    .get(input.account) as ProviderRow | undefined;

  const oauthPayload = JSON.stringify({
    clientId: input.clientId,
    tenantId: "common",
    scopes: providerScopes.outlook,
    imapHost: "outlook.office365.com",
    imapPort: 993,
  });

  const encryptedSecret = serializeSecrets({
    password: input.password,
    refreshToken: input.refreshToken,
  });

  if (!existing) {
    const mailboxId = createMailboxId("outlook");
    db.prepare(`
      INSERT INTO providers (id, provider_id, mode, account, encrypted_secret, oauth_payload, status, health, last_synced_at, last_error)
      VALUES (@id, 'outlook', 'imap', @account, @encrypted_secret, @oauth_payload, 'disconnected', 'healthy', '未同步', NULL)
    `).run({
      id: mailboxId,
      account: input.account,
      encrypted_secret: encryptedSecret,
      oauth_payload: oauthPayload,
    });

    return {
      mailboxId,
      account: input.account,
      updated: false,
    };
  }

  const existingSecrets = parseSecrets(existing.encrypted_secret);
  db.prepare(`
    UPDATE providers
    SET mode = 'imap',
        account = @account,
        encrypted_secret = @encrypted_secret,
        oauth_payload = @oauth_payload,
        status = 'disconnected',
        health = 'healthy',
        last_error = NULL
    WHERE id = @id
  `).run({
    id: existing.id,
    account: input.account,
    encrypted_secret: serializeSecrets({
      ...existingSecrets,
      password: input.password,
      refreshToken: input.refreshToken,
    }),
    oauth_payload: oauthPayload,
  });

  return {
    mailboxId: existing.id,
    account: input.account,
    updated: true,
  };
}

export function deleteMailboxConfig(providerId: ProviderId, mailboxId: string) {
  ensureSeeded();
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM providers WHERE id = ? AND provider_id = ?")
    .get(mailboxId, providerId) as ProviderRow | undefined;

  if (!row) {
    throw new Error(`Mailbox not found: ${mailboxId}`);
  }

  const remove = db.transaction(() => {
    db.prepare("DELETE FROM messages WHERE mailbox_id = ?").run(mailboxId);
    db.prepare("DELETE FROM providers WHERE id = ? AND provider_id = ?").run(mailboxId, providerId);
  });

  remove();
}

function mapMessageRow(row: MessageRow): MailMessage {
  const attachments = JSON.parse(row.attachments_json || "[]") as MailAttachment[];
  return {
    id: row.id,
    providerId: row.provider_id,
    mailboxId: row.mailbox_id || row.provider_id,
    remoteId: row.remote_id ?? undefined,
    remoteFolder: row.remote_folder ?? undefined,
    providerLabel: row.provider_label,
    from: row.from_name,
    subject: row.subject,
    preview: row.preview,
    receivedAt: row.received_at,
    unread: Boolean(row.unread),
    hasAttachments: Boolean(row.has_attachments),
    tags: JSON.parse(row.tags || "[]") as string[],
    attachments,
  };
}

export function upsertMessages(
  mailboxId: string,
  providerId: ProviderId,
  messages: Array<MailMessage & Pick<MailDetail, "text" | "html">>,
) {
  ensureSeeded();
  const db = getDb();
  const insert = db.prepare(`
    INSERT INTO messages (
      id, provider_id, from_name, subject, preview, received_at, unread,
      mailbox_id, remote_id, remote_folder, has_attachments, tags, provider_label, attachments_json, text_content, html_content, detail_cache
    ) VALUES (
      @id, @provider_id, @from_name, @subject, @preview, @received_at, @unread,
      @mailbox_id, @remote_id, @remote_folder, @has_attachments, @tags, @provider_label, @attachments_json, @text_content, @html_content, @detail_cache
    )
    ON CONFLICT(id) DO UPDATE SET
      from_name = excluded.from_name,
      subject = excluded.subject,
      preview = excluded.preview,
      received_at = excluded.received_at,
      unread = CASE
        WHEN messages.locally_read_at IS NOT NULL THEN 0
        ELSE excluded.unread
      END,
      mailbox_id = excluded.mailbox_id,
      remote_id = excluded.remote_id,
      remote_folder = excluded.remote_folder,
      has_attachments = excluded.has_attachments,
      tags = excluded.tags,
      provider_label = excluded.provider_label,
      attachments_json = excluded.attachments_json,
      text_content = excluded.text_content,
      html_content = excluded.html_content,
      detail_cache = excluded.detail_cache
  `);

  const writeMany = db.transaction((items: Array<MailMessage & Pick<MailDetail, "text" | "html">>) => {
    for (const message of items) {
      insert.run({
        id: message.id,
        provider_id: providerId,
        from_name: message.from,
        subject: message.subject,
        preview: message.preview,
        received_at: message.receivedAt,
        unread: message.unread ? 1 : 0,
        mailbox_id: mailboxId,
        remote_id: message.remoteId ?? null,
        remote_folder: message.remoteFolder ?? null,
        has_attachments: message.hasAttachments ? 1 : 0,
        tags: JSON.stringify(message.tags),
        provider_label: message.providerLabel,
        attachments_json: JSON.stringify(message.attachments),
        text_content: message.text,
        html_content: message.html,
        detail_cache: null,
      });
    }
  });

  writeMany(messages);
}

export function replaceMailboxMessages(
  mailboxId: string,
  providerId: ProviderId,
  messages: Array<MailMessage & Pick<MailDetail, "text" | "html">>,
  legacyMessageIds: string[] = [],
) {
  ensureSeeded();
  const db = getDb();
  const legacyReadState = db.prepare("SELECT locally_read_at FROM messages WHERE id = ? AND locally_read_at IS NOT NULL");
  const applyLegacyReadState = db.prepare("UPDATE messages SET locally_read_at = COALESCE(locally_read_at, ?) WHERE id = ?");
  const clearLegacyIds = db.prepare("DELETE FROM messages WHERE id = ?");

  const writeAll = db.transaction(() => {
    const readStateById = new Map<string, string>();

    legacyMessageIds.forEach((legacyId, index) => {
      const row = legacyReadState.get(legacyId) as { locally_read_at: string } | undefined;
      const message = messages[index];
      if (row?.locally_read_at && message) {
        message.unread = false;
        readStateById.set(message.id, row.locally_read_at);
      }
    });

    upsertMessages(mailboxId, providerId, messages);

    for (const [messageId, locallyReadAt] of readStateById) {
      applyLegacyReadState.run(locallyReadAt, messageId);
    }

    for (const legacyId of legacyMessageIds) {
      clearLegacyIds.run(legacyId);
    }
  });

  writeAll();
}

export function listMessages() {
  ensureSeeded();
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM messages ORDER BY datetime(received_at) DESC, id DESC")
    .all() as MessageRow[];
  return rows.map(mapMessageRow);
}

export function listUnreadMessages(limit = 20) {
  ensureSeeded();
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM messages WHERE unread = 1 ORDER BY datetime(received_at) DESC, id DESC LIMIT ?")
    .all(limit) as MessageRow[];
  return rows.map(mapMessageRow);
}

export function listRecentMessages(limit = 20) {
  ensureSeeded();
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM messages ORDER BY datetime(received_at) DESC, id DESC LIMIT ?")
    .all(limit) as MessageRow[];
  return rows.map(mapMessageRow);
}

export function markMessageAsRead(messageId: string) {
  ensureSeeded();
  const db = getDb();
  db.prepare("UPDATE messages SET unread = 0, locally_read_at = ? WHERE id = ?").run(new Date().toISOString(), messageId);
}

export function getMessageDetail(messageId: string): MailDetail | undefined {
  ensureSeeded();
  const db = getDb();
  const row = db.prepare("SELECT * FROM messages WHERE id = ?").get(messageId) as MessageRow | undefined;
  if (!row) return undefined;
  const base = mapMessageRow(row);
  const text = row.text_content || base.preview;
  return {
    ...base,
    text,
    html: getOriginalEmailHtml(row.html_content, text),
  };
}

export function getStoredMessageRow(messageId: string) {
  ensureSeeded();
  const db = getDb();
  return db.prepare("SELECT * FROM messages WHERE id = ?").get(messageId) as MessageRow | undefined;
}

export function updateMessageDetail(
  messageId: string,
  input: {
    preview?: string;
    text: string;
    html: string;
    hasAttachments?: boolean;
    attachments?: MailAttachment[];
    from?: string;
    subject?: string;
    receivedAt?: string;
    unread?: boolean;
  },
) {
  ensureSeeded();
  const db = getDb();
  db.prepare(`
    UPDATE messages
    SET from_name = COALESCE(@from_name, from_name),
        subject = COALESCE(@subject, subject),
        preview = COALESCE(@preview, preview),
        received_at = COALESCE(@received_at, received_at),
        unread = CASE
          WHEN locally_read_at IS NOT NULL THEN 0
          ELSE COALESCE(@unread, unread)
        END,
        has_attachments = COALESCE(@has_attachments, has_attachments),
        attachments_json = COALESCE(@attachments_json, attachments_json),
        text_content = @text_content,
        html_content = @html_content
    WHERE id = @id
  `).run({
    id: messageId,
    from_name: input.from ?? null,
    subject: input.subject ?? null,
    preview: input.preview ?? null,
    received_at: input.receivedAt ?? null,
    unread: typeof input.unread === "boolean" ? (input.unread ? 1 : 0) : null,
    has_attachments: typeof input.hasAttachments === "boolean" ? (input.hasAttachments ? 1 : 0) : null,
    attachments_json: input.attachments ? JSON.stringify(input.attachments) : null,
    text_content: input.text,
    html_content: input.html,
  });
}

export function markAllAsRead({
  source = "all",
  mailboxId,
}: {
  source?: ProviderId | "all";
  mailboxId?: string;
}) {
  ensureSeeded();
  const db = getDb();
  if (mailboxId) {
    db.prepare("UPDATE messages SET unread = 0, locally_read_at = ? WHERE mailbox_id = ? AND unread = 1")
      .run(new Date().toISOString(), mailboxId);
  } else if (source && source !== "all") {
    db.prepare("UPDATE messages SET unread = 0, locally_read_at = ? WHERE provider_id = ? AND unread = 1")
      .run(new Date().toISOString(), source);
  } else {
    db.prepare("UPDATE messages SET unread = 0, locally_read_at = ? WHERE unread = 1")
      .run(new Date().toISOString());
  }
}

export function markMessageAsUnread(messageId: string) {
  ensureSeeded();
  const db = getDb();
  db.prepare("UPDATE messages SET unread = 1, locally_read_at = NULL WHERE id = ?").run(messageId);
}

export function deleteMessage(messageId: string) {
  ensureSeeded();
  const db = getDb();
  db.prepare("DELETE FROM messages WHERE id = ?").run(messageId);
}

export function clearMailboxMessages(providerId: ProviderId, mailboxId: string) {
  ensureSeeded();
  const db = getDb();
  const row = db
    .prepare("SELECT id FROM providers WHERE id = ? AND provider_id = ?")
    .get(mailboxId, providerId) as { id: string } | undefined;

  if (!row) {
    throw new Error(`Mailbox not found: ${mailboxId}`);
  }

  db.prepare("DELETE FROM messages WHERE mailbox_id = ? AND provider_id = ?").run(mailboxId, providerId);
}

export function clearAllMessages() {
  ensureSeeded();
  const db = getDb();
  db.prepare("DELETE FROM messages").run();
}

