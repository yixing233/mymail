# Settings Backup And Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add full backup export and restore import to the settings dialog, covering app settings, provider configs, saved credentials, and cached messages with replace and merge modes.

**Architecture:** Add a focused `lib/backup.ts` module for versioned JSON export, schema validation, and transactional restore. Extend `app/api/settings/route.ts` with `exportBackup` and `importBackup` actions, then wire a small backup section into the existing settings dialog in `components/providers-panel.tsx`.

**Tech Stack:** Next.js 16, TypeScript, React 19, Vitest, SQLite (`better-sqlite3`), Zod

---

### Task 1: Add backup module tests first

**Files:**
- Create: `E:\Code\mymail\tests\backup.test.ts`
- Test: `E:\Code\mymail\tests\backup.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/backup.test.ts` covering:

```typescript
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import {
  buildBackupPayload,
  importBackupPayload,
  parseBackupPayload,
} from "@/lib/backup";
import {
  saveImapConfig,
  saveOAuthConfig,
  updateMessageDetail,
  upsertMessages,
} from "@/lib/provider-store";
import { setAutoSyncFetchLimit, setNotificationsEnabled, setRefreshIntervalSeconds } from "@/lib/app-settings";

describe("backup payloads", () => {
  beforeEach(() => {
    const db = getDb();
    db.prepare("DELETE FROM messages").run();
    db.prepare("DELETE FROM providers").run();
    db.prepare("DELETE FROM app_settings").run();
  });

  it("exports app settings, providers, and messages in a versioned payload", () => {
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

  it("replaces existing data when importing in replace mode", () => {
    const payload = parseBackupPayload({
      version: 1,
      exportedAt: "2026-06-11T10:00:00.000Z",
      appSettings: [{ key: "refresh_interval_seconds", value: "600", updated_at: "2026-06-11T10:00:00.000Z" }],
      providers: [{
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
      }],
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
    expect((db.prepare("SELECT COUNT(*) AS count FROM providers").get() as { count: number }).count).toBe(1);
    expect((db.prepare("SELECT account FROM providers WHERE id = ?").get("gmail-box-1") as { account: string }).account).toBe("user@gmail.com");
  });

  it("merges imported rows by primary key", () => {
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

  it("rejects unsupported versions", () => {
    expect(() => parseBackupPayload({
      version: 99,
      exportedAt: "2026-06-11T10:00:00.000Z",
      appSettings: [],
      providers: [],
      messages: [],
    })).toThrow("不支持的备份版本");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/backup.test.ts`
Expected: FAIL because `lib/backup.ts` does not exist yet

- [ ] **Step 3: Commit**

```bash
git add tests/backup.test.ts
git commit -m "test: add backup module coverage"
```

If `git` is unavailable because this directory is not a repository, skip the commit and continue.

### Task 2: Implement backup module

**Files:**
- Create: `E:\Code\mymail\lib\backup.ts`
- Test: `E:\Code\mymail\tests\backup.test.ts`

- [ ] **Step 1: Write minimal implementation**

Create `lib/backup.ts` with:

```typescript
import { z } from "zod";
import { getDb } from "@/lib/db";

const backupRowSchema = z.object({
  key: z.string(),
  value: z.string(),
  updated_at: z.string(),
});

const providerRowSchema = z.object({
  id: z.string(),
  provider_id: z.enum(["gmail", "outlook", "qq", "mail163"]),
  mode: z.enum(["oauth", "imap"]),
  account: z.string(),
  encrypted_secret: z.string().nullable(),
  oauth_payload: z.string().nullable(),
  status: z.enum(["connected", "degraded", "disconnected", "reauth"]),
  health: z.enum(["healthy", "rate_limited", "offline", "auth_expired", "error"]),
  last_synced_at: z.string(),
  last_error: z.string().nullable(),
});

const messageRowSchema = z.object({
  id: z.string(),
  provider_id: z.enum(["gmail", "outlook", "qq", "mail163"]),
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
  appSettings: z.array(backupRowSchema),
  providers: z.array(providerRowSchema),
  messages: z.array(messageRowSchema),
});

export type BackupPayload = z.infer<typeof backupPayloadSchema>;
export type BackupImportMode = "replace" | "merge";

export function parseBackupPayload(input: unknown): BackupPayload {
  const parsed = backupPayloadSchema.safeParse(input);
  if (!parsed.success) {
    const version = (input as { version?: unknown } | null)?.version;
    if (version !== 1) {
      throw new Error("不支持的备份版本");
    }
    throw new Error("备份文件格式无效");
  }
  return parsed.data;
}

export function buildBackupPayload(): BackupPayload {
  const db = getDb();
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    appSettings: db.prepare("SELECT key, value, updated_at FROM app_settings ORDER BY key").all() as BackupPayload["appSettings"],
    providers: db.prepare("SELECT id, provider_id, mode, account, encrypted_secret, oauth_payload, status, health, last_synced_at, last_error FROM providers ORDER BY provider_id, id").all() as BackupPayload["providers"],
    messages: db.prepare("SELECT id, provider_id, mailbox_id, remote_id, remote_folder, from_name, subject, preview, received_at, unread, has_attachments, tags, provider_label, attachments_json, text_content, html_content, locally_read_at FROM messages ORDER BY datetime(received_at) DESC, id DESC").all() as BackupPayload["messages"],
  };
}

export function importBackupPayload(payload: BackupPayload, mode: BackupImportMode) {
  const db = getDb();
  const run = db.transaction(() => {
    if (mode === "replace") {
      db.prepare("DELETE FROM messages").run();
      db.prepare("DELETE FROM providers").run();
      db.prepare("DELETE FROM app_settings").run();
    }

    const upsertSetting = db.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (@key, @value, @updated_at)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
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
      INSERT INTO messages (id, provider_id, mailbox_id, remote_id, remote_folder, from_name, subject, preview, received_at, unread, has_attachments, tags, provider_label, attachments_json, text_content, html_content, locally_read_at)
      VALUES (@id, @provider_id, @mailbox_id, @remote_id, @remote_folder, @from_name, @subject, @preview, @received_at, @unread, @has_attachments, @tags, @provider_label, @attachments_json, @text_content, @html_content, @locally_read_at)
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

    payload.appSettings.forEach((row) => upsertSetting.run(row));
    payload.providers.forEach((row) => upsertProvider.run(row));
    payload.messages.forEach((row) => upsertMessage.run(row));
  });

  run();
  return {
    success: true,
    mode,
    appSettingsCount: payload.appSettings.length,
    providersCount: payload.providers.length,
    messagesCount: payload.messages.length,
  };
}
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npm test -- tests/backup.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add lib/backup.ts tests/backup.test.ts
git commit -m "feat: add backup payload import and export logic"
```

If `git` is unavailable because this directory is not a repository, skip the commit and continue.

### Task 3: Extend settings route for export and import

**Files:**
- Modify: `E:\Code\mymail\app\api\settings\route.ts`
- Create: `E:\Code\mymail\tests\settings-route.test.ts`
- Test: `E:\Code\mymail\tests\settings-route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/settings-route.test.ts` with:

```typescript
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { POST } from "@/app/api/settings/route";

describe("settings backup actions", () => {
  beforeEach(() => {
    const db = getDb();
    db.prepare("DELETE FROM messages").run();
    db.prepare("DELETE FROM providers").run();
    db.prepare("DELETE FROM app_settings").run();
  });

  it("returns a backup payload for exportBackup", async () => {
    const response = await POST(new Request("http://localhost/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "exportBackup" }),
    }) as never);

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.version).toBe(1);
    expect(Array.isArray(payload.providers)).toBe(true);
  });

  it("imports a backup payload for importBackup", async () => {
    const response = await POST(new Request("http://localhost/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "importBackup",
        mode: "replace",
        payload: {
          version: 1,
          exportedAt: "2026-06-11T10:00:00.000Z",
          appSettings: [],
          providers: [],
          messages: [],
        },
      }),
    }) as never);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, mode: "replace" });
  });

  it("rejects invalid import modes", async () => {
    const response = await POST(new Request("http://localhost/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "importBackup",
        mode: "invalid",
        payload: {
          version: 1,
          exportedAt: "2026-06-11T10:00:00.000Z",
          appSettings: [],
          providers: [],
          messages: [],
        },
      }),
    }) as never);

    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/settings-route.test.ts`
Expected: FAIL because the route does not support `exportBackup` or `importBackup`

- [ ] **Step 3: Write minimal implementation**

Update `app/api/settings/route.ts` to:

```typescript
import { buildBackupPayload, importBackupPayload, parseBackupPayload } from "@/lib/backup";

const settingsActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("clearAllMessages") }),
  z.object({ action: z.literal("exportBackup") }),
  z.object({
    action: z.literal("importBackup"),
    mode: z.enum(["replace", "merge"]),
    payload: z.unknown(),
  }),
]);

// inside POST
if (parsed.data.action === "clearAllMessages") {
  clearAllMessages();
  return NextResponse.json({ success: true });
}

if (parsed.data.action === "exportBackup") {
  return NextResponse.json(buildBackupPayload());
}

if (parsed.data.action === "importBackup") {
  const payload = parseBackupPayload(parsed.data.payload);
  return NextResponse.json(importBackupPayload(payload, parsed.data.mode));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/settings-route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/settings/route.ts tests/settings-route.test.ts lib/backup.ts
git commit -m "feat: add settings backup api actions"
```

If `git` is unavailable because this directory is not a repository, skip the commit and continue.

### Task 4: Add settings dialog backup UI

**Files:**
- Modify: `E:\Code\mymail\components\providers-panel.tsx`
- Create: `E:\Code\mymail\tests\settings-backup-ui.test.ts`
- Test: `E:\Code\mymail\tests\settings-backup-ui.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/settings-backup-ui.test.ts` with:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/settings-backup-ui.test.ts`
Expected: FAIL because the settings dialog does not yet contain the backup controls

- [ ] **Step 3: Write minimal implementation**

In `components/providers-panel.tsx`, add:

- state for selected backup file name
- state for parsed backup payload text
- loading states for export and import
- helper to export JSON as a downloaded file
- helper to read a selected file
- button handlers for:
  - export
  - import replace
  - import merge

Required UI strings:

```tsx
<span className="block text-base font-semibold text-slate-900">备份与恢复</span>
<button type="button">导出备份</button>
<button type="button">导入并覆盖</button>
<button type="button">导入并合并</button>
```

Interaction requirements:

- import buttons disabled until a backup file is selected and parsed
- replace import uses `window.confirm("会清空当前本地设置、邮箱配置和邮件缓存，再恢复备份内容")`
- merge import posts without confirmation
- both import paths call `router.refresh()` on success

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/settings-backup-ui.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/providers-panel.tsx tests/settings-backup-ui.test.ts
git commit -m "feat: add settings backup and restore controls"
```

If `git` is unavailable because this directory is not a repository, skip the commit and continue.

### Task 5: Full verification

**Files:**
- Verify only

- [ ] **Step 1: Run targeted backup tests**

Run: `npm test -- tests/backup.test.ts tests/settings-route.test.ts tests/settings-backup-ui.test.ts`
Expected: PASS

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "feat: add settings backup and restore"
```

If `git` is unavailable because this directory is not a repository, skip the commit and continue.
