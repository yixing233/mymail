import { getDb } from "@/lib/db";
import type { RunLogItem } from "@/lib/run-logs";

const maxServerRunLogs = 300;

interface RunLogRow {
  id: string;
  at: string;
  tone: RunLogItem["tone"];
  message: string;
  provider: string | null;
  account: string | null;
}

function mapRow(row: RunLogRow): RunLogItem {
  return {
    id: row.id,
    at: row.at,
    tone: row.tone,
    message: row.message,
    provider: row.provider ?? undefined,
    account: row.account ?? undefined,
  };
}

function pruneServerRunLogs() {
  getDb().prepare(`
    DELETE FROM run_logs
    WHERE id NOT IN (
      SELECT id FROM run_logs
      ORDER BY at DESC
      LIMIT ?
    )
  `).run(maxServerRunLogs);
}

export function readServerRunLogs() {
  return getDb()
    .prepare("SELECT id, at, tone, message, provider, account FROM run_logs ORDER BY at DESC LIMIT ?")
    .all(maxServerRunLogs)
    .map((row) => mapRow(row as RunLogRow));
}

export function appendServerRunLog(input: Omit<RunLogItem, "id" | "at">) {
  const now = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO run_logs (id, at, tone, message, provider, account)
    VALUES (@id, @at, @tone, @message, @provider, @account)
  `).run({
    id: `server-${now}-${Math.random().toString(36).slice(2, 8)}`,
    at: now,
    tone: input.tone,
    message: input.message,
    provider: input.provider ?? null,
    account: input.account ?? null,
  });
  pruneServerRunLogs();
}

export function clearServerRunLogs() {
  getDb().prepare("DELETE FROM run_logs").run();
}
