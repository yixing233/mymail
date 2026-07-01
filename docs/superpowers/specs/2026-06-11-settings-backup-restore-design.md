# Settings Backup And Restore Design

## Goal

Add import and export capability to the settings page so the user can back up and restore the full local application dataset, including app settings, provider configuration data, saved credentials, and synchronized message data.

## Current Context

- The settings UI currently lives inside the settings dialog in `components/providers-panel.tsx`.
- Settings data is served from `app/api/settings/route.ts`.
- Local persisted data is stored in SQLite through `lib/db.ts`.
- The main business tables currently relevant to this feature are:
  - `app_settings`
  - `providers`
  - `messages`
- The project already has server-side actions for settings updates and destructive operations such as clearing cached messages.

## Scope

This feature adds:

- full-data export from the settings page
- full-data import from the settings page
- two import modes:
  - replace
  - merge

This feature does not add:

- cloud backup
- encrypted backup files
- zip packaging
- partial restore
- backup preview UI
- drag-and-drop upload

## Chosen Approach

Use a structured JSON backup payload rather than exporting the raw SQLite file.

The backup file will contain:

- backup format version
- exported timestamp
- `appSettings`
- `providers`
- `messages`

The settings page will expose:

- `导出备份`
- file picker for `.json`
- `导入并覆盖`
- `导入并合并`

The server-side feature will be implemented behind the existing settings route using new `POST` actions.

## Why This Approach

Structured JSON is the best fit for the requested behavior because:

- replace restore is easy to implement safely in a transaction
- merge restore is feasible with table-aware upsert logic
- the payload can evolve with a version number
- the feature remains understandable in the settings UI

Exporting the raw SQLite file would be simpler for replace-only restore, but it would not support merge semantics cleanly and would make future compatibility handling worse.

## Data Model Coverage

### Included

- all rows in `app_settings`
- all rows in `providers`
- all rows in `messages`

### Excluded

- run logs
- transient scheduler state
- browser-only state
- non-database temp files

## Credential Handling

Saved credentials and tokens stored in `providers` are included in the backup exactly as stored in the database.

That means:

- encrypted secrets remain encrypted in the backup payload
- OAuth payloads remain as stored
- export does not decrypt secrets just to re-encode them

This keeps the feature aligned with existing storage behavior and avoids introducing extra secret transformation paths.

## Backup File Format

The JSON payload should have a stable top-level structure:

```json
{
  "version": 1,
  "exportedAt": "2026-06-11T00:00:00.000Z",
  "appSettings": [],
  "providers": [],
  "messages": []
}
```

### App settings records

Each record mirrors the database row:

```json
{
  "key": "refreshInterval",
  "value": "300",
  "updated_at": "2026-06-11T00:00:00.000Z"
}
```

### Provider records

Each record mirrors the `providers` table row, including encrypted credential fields and saved OAuth payload data.

### Message records

Each record mirrors the `messages` table row, including metadata, cached text and HTML content, read state, and attachment JSON.

## Server Architecture

Add a dedicated backup module, for example `lib/backup.ts`, with focused responsibilities:

- `buildBackupPayload()`
- `parseBackupPayload()`
- `restoreBackupReplace()`
- `restoreBackupMerge()`

This keeps backup behavior out of `app/api/settings/route.ts` and allows direct unit testing.

### `buildBackupPayload()`

- read all rows from the three tables
- construct the versioned JSON shape

### `parseBackupPayload()`

- parse incoming JSON
- validate shape and types with `zod`
- reject unsupported versions

### `restoreBackupReplace()`

- open a SQLite transaction
- clear `messages`, `providers`, and `app_settings`
- insert backup rows
- commit only if the full restore succeeds

### `restoreBackupMerge()`

- open a SQLite transaction
- upsert into `app_settings` by `key`
- upsert into `providers` by `id`
- upsert into `messages` by `id`
- do not delete rows missing from the backup

## API Design

Keep the feature under the existing route: `app/api/settings/route.ts`.

### Existing methods

- `GET` stays unchanged
- `PATCH` stays unchanged

### Extended `POST` actions

Add new `action` values:

- `exportBackup`
- `importBackup`

### Export request

```json
{
  "action": "exportBackup"
}
```

### Export response

Return the JSON payload directly as structured data. The client will turn it into a downloadable file.

### Import request

```json
{
  "action": "importBackup",
  "mode": "replace",
  "payload": {
    "version": 1,
    "exportedAt": "2026-06-11T00:00:00.000Z",
    "appSettings": [],
    "providers": [],
    "messages": []
  }
}
```

`mode` supports:

- `replace`
- `merge`

### Import response

Return:

- `success`
- summary counts for imported or updated rows
- selected mode

Example summary fields:

- `appSettingsCount`
- `providersCount`
- `messagesCount`

## UI Design

Extend the settings dialog in `components/providers-panel.tsx` with a new section titled `备份与恢复`.

Place it:

- below `清空全部邮件`
- above `新邮件通知`

### Controls

- export button
- file input
- replace import button
- merge import button
- explanatory text

### Interaction rules

- import buttons are disabled until a `.json` file is selected
- export shows a loading state while the request is in progress
- replace import requires an explicit confirmation step
- merge import can run directly
- after successful import, refresh settings and the current route data
- after successful import, keep UX explicit with a toast summary
- after failed import, show the server error and keep the file selected

### Suggested copy

- replace warning:
  - `会清空当前本地设置、邮箱配置和邮件缓存，再恢复备份内容`
- merge warning:
  - `会保留当前数据，并按主键更新重复记录`
- backup description:
  - `备份文件包含本地设置、已保存邮箱配置和本地邮件缓存`

## Data Flow

### Export flow

1. user clicks `导出备份`
2. client posts `{ action: "exportBackup" }`
3. server returns backup payload
4. client serializes the payload
5. client downloads `mymail-backup-YYYYMMDD-HHmmss.json`

### Replace import flow

1. user selects a JSON file
2. client reads and parses the file
3. user clicks `导入并覆盖`
4. client asks for confirmation
5. client posts `{ action: "importBackup", mode: "replace", payload }`
6. server validates and restores in one transaction
7. client shows summary and refreshes the UI

### Merge import flow

1. user selects a JSON file
2. client reads and parses the file
3. user clicks `导入并合并`
4. client posts `{ action: "importBackup", mode: "merge", payload }`
5. server validates and upserts in one transaction
6. client shows summary and refreshes the UI

## Error Handling

Reject and report these cases clearly:

- invalid JSON
- wrong schema
- unsupported backup version
- missing required row identifiers
- database failure during restore

Behavior rules:

- all import work runs inside a transaction
- any failure rolls back the entire import
- no partial restore state is allowed

## Testing Strategy

### Unit tests

- backup export shape
- backup schema validation
- replace restore behavior
- merge restore behavior
- invalid payload rejection

### Route tests

- `POST /api/settings` with `exportBackup`
- `POST /api/settings` with `importBackup`
- invalid `mode`
- invalid payload schema

### UI tests

- backup section renders in settings dialog
- import buttons stay disabled without file selection
- file selection updates state
- export action triggers download flow logic
- replace import requires confirmation

## Risks And Constraints

### Data volume

Large message tables can produce large JSON files. This is acceptable for the first version because the user explicitly asked for full backup.

### Sensitive data

The backup includes locally stored credentials and tokens. This is required for full restore behavior, so the UI copy should make that clear.

### Schema evolution

The version field is mandatory so future schema changes can reject or migrate older backup formats explicitly.

## Implementation Notes

- follow current project patterns: route-level validation with `zod`, persistence helpers in `lib/`
- keep backup logic out of the large UI component except for request and state handling
- prefer transaction-based restore helpers rather than ad hoc SQL inside the route

## Recommendation

Proceed with:

- versioned JSON backup payloads
- shared settings route actions
- replace and merge import modes
- dedicated backup helper module
- minimal settings dialog UI extension
