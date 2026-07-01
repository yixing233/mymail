import { getDb } from "@/lib/db";

export const refreshIntervalValues = [0, 300, 600, 1800] as const;

const refreshIntervalKey = "refresh_interval_seconds";
const notificationsEnabledKey = "browser_notifications_enabled";
const singleSyncFetchLimitKey = "single_sync_fetch_limit";
const bulkSyncFetchLimitKey = "bulk_sync_fetch_limit";
const autoSyncFetchLimitKey = "auto_sync_fetch_limit";
const defaultSyncFetchLimit = 3;
const minSyncFetchLimit = 1;
const maxSyncFetchLimit = 3;

export type RefreshIntervalSeconds = (typeof refreshIntervalValues)[number];

function isRefreshIntervalSeconds(value: number): value is RefreshIntervalSeconds {
  return refreshIntervalValues.includes(value as RefreshIntervalSeconds);
}

function readSetting(key: string) {
  const db = getDb();
  return db
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
}

function writeSetting(key: string, value: string) {
  const db = getDb();
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `).run(key, value, new Date().toISOString());
}

export function getRefreshIntervalSeconds(): RefreshIntervalSeconds {
  const row = readSetting(refreshIntervalKey);
  const value = Number(row?.value ?? 0);
  if (value === 60) {
    return setRefreshIntervalSeconds(300);
  }
  return isRefreshIntervalSeconds(value) ? value : 0;
}

export function setRefreshIntervalSeconds(value: number): RefreshIntervalSeconds {
  if (!isRefreshIntervalSeconds(value)) {
    throw new Error("不支持的自动刷新间隔");
  }

  writeSetting(refreshIntervalKey, String(value));
  return value;
}

function readBooleanSetting(key: string, defaultValue = false) {
  const row = readSetting(key);
  if (!row) return defaultValue;
  return row.value === "1" || row.value === "true";
}

function writeBooleanSetting(key: string, value: boolean) {
  writeSetting(key, value ? "1" : "0");
  return value;
}

function isSyncFetchLimit(value: number) {
  return Number.isInteger(value) && value >= minSyncFetchLimit && value <= maxSyncFetchLimit;
}

function readNumberSetting(key: string, defaultValue: number) {
  const row = readSetting(key);
  const value = Number(row?.value ?? defaultValue);
  return Number.isFinite(value) ? value : defaultValue;
}

function writeNumberSetting(key: string, value: number) {
  writeSetting(key, String(value));
  return value;
}

function setSyncFetchLimit(key: string, value: number) {
  if (!isSyncFetchLimit(value)) {
    throw new Error("邮件获取数量必须在 1 到 3 之间");
  }

  return writeNumberSetting(key, value);
}

export function getSingleSyncFetchLimit() {
  const value = readNumberSetting(singleSyncFetchLimitKey, defaultSyncFetchLimit);
  return isSyncFetchLimit(value) ? value : defaultSyncFetchLimit;
}

export function setSingleSyncFetchLimit(value: number) {
  return setSyncFetchLimit(singleSyncFetchLimitKey, value);
}

export function getBulkSyncFetchLimit() {
  const value = readNumberSetting(bulkSyncFetchLimitKey, defaultSyncFetchLimit);
  return isSyncFetchLimit(value) ? value : defaultSyncFetchLimit;
}

export function setBulkSyncFetchLimit(value: number) {
  return setSyncFetchLimit(bulkSyncFetchLimitKey, value);
}

export function getAutoSyncFetchLimit() {
  const value = readNumberSetting(autoSyncFetchLimitKey, defaultSyncFetchLimit);
  return isSyncFetchLimit(value) ? value : defaultSyncFetchLimit;
}

export function setAutoSyncFetchLimit(value: number) {
  return setSyncFetchLimit(autoSyncFetchLimitKey, value);
}

export function getNotificationsEnabled() {
  return readBooleanSetting(notificationsEnabledKey);
}

export function setNotificationsEnabled(value: boolean) {
  return writeBooleanSetting(notificationsEnabledKey, value);
}
