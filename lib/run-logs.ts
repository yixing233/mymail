"use client";

export type RunLogTone = "info" | "success" | "error";

export interface RunLogItem {
  id: string;
  at: string;
  tone: RunLogTone;
  message: string;
  provider?: string;
  account?: string;
}

const runLogStorageKey = "mymail:run-logs";
const runLogEventName = "mymail:run-logs-updated";
const maxRunLogs = 200;

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function readRunLogs(): RunLogItem[] {
  if (!canUseStorage()) return [];

  try {
    const raw = window.localStorage.getItem(runLogStorageKey);
    return raw ? (JSON.parse(raw) as RunLogItem[]) : [];
  } catch {
    return [];
  }
}

export function writeRunLogs(logs: RunLogItem[]) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(runLogStorageKey, JSON.stringify(logs.slice(0, maxRunLogs)));
  window.dispatchEvent(new Event(runLogEventName));
}

export function appendRunLog(input: Omit<RunLogItem, "id" | "at">) {
  const now = new Date().toISOString();
  const next = [
    {
      id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
      at: now,
      ...input,
    },
    ...readRunLogs(),
  ].slice(0, maxRunLogs);
  writeRunLogs(next);
}

export function clearRunLogs() {
  writeRunLogs([]);
}

export function subscribeRunLogs(listener: () => void) {
  if (typeof window === "undefined") return () => {};

  const handleStorage = (event: StorageEvent) => {
    if (event.key === runLogStorageKey) listener();
  };

  window.addEventListener(runLogEventName, listener);
  window.addEventListener("storage", handleStorage);

  return () => {
    window.removeEventListener(runLogEventName, listener);
    window.removeEventListener("storage", handleStorage);
  };
}
