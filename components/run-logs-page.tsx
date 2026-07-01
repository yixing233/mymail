"use client";

import { useEffect, useState } from "react";
import { clearRunLogs, readRunLogs, subscribeRunLogs, type RunLogItem } from "@/lib/run-logs";

type LogFilter = "all" | RunLogItem["tone"];

function formatLogTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function toneClass(tone: RunLogItem["tone"]) {
  if (tone === "success") return "bg-emerald-500";
  if (tone === "error") return "bg-rose-500";
  return "bg-sky-500";
}

function toneText(tone: RunLogItem["tone"]) {
  if (tone === "success") return "成功";
  if (tone === "error") return "失败";
  return "信息";
}

export function RunLogsPage({ embedded = false }: { embedded?: boolean }) {
  const [logs, setLogs] = useState<RunLogItem[]>([]);
  const [serverLogs, setServerLogs] = useState<RunLogItem[]>([]);
  const [activeFilter, setActiveFilter] = useState<LogFilter>("all");

  useEffect(() => {
    setLogs(readRunLogs());
    return subscribeRunLogs(() => {
      setLogs(readRunLogs());
    });
  }, []);

  useEffect(() => {
    let alive = true;

    async function loadServerLogs() {
      try {
        const response = await fetch("/api/run-logs", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as { logs?: RunLogItem[] };
        if (alive) {
          setServerLogs(data.logs ?? []);
        }
      } catch {
        if (alive) {
          setServerLogs([]);
        }
      }
    }

    void loadServerLogs();
    const timerId = window.setInterval(() => {
      void loadServerLogs();
    }, 5000);

    return () => {
      alive = false;
      window.clearInterval(timerId);
    };
  }, []);

  const mergedLogs = [...logs, ...serverLogs]
    .filter((log, index, items) => items.findIndex((item) => item.id === log.id) === index)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const logCounts = {
    all: mergedLogs.length,
    success: mergedLogs.filter((log) => log.tone === "success").length,
    info: mergedLogs.filter((log) => log.tone === "info").length,
    error: mergedLogs.filter((log) => log.tone === "error").length,
  };
  const filterTabs = [
    { id: "all", label: "全部", count: logCounts.all },
    { id: "success", label: "成功", count: logCounts.success },
    { id: "info", label: "信息", count: logCounts.info },
    { id: "error", label: "失败", count: logCounts.error },
  ] satisfies Array<{ id: LogFilter; label: string; count: number }>;
  const visibleLogs = activeFilter === "all" ? mergedLogs : mergedLogs.filter((log) => log.tone === activeFilter);
  const emptyText = mergedLogs.length === 0 ? "暂无运行日志" : `暂无${filterTabs.find((tab) => tab.id === activeFilter)?.label ?? ""}日志`;

  const content = (
    <section
      className={
        embedded
          ? "flex h-full min-h-0 flex-col overflow-hidden bg-white/78"
          : "mx-auto flex h-[calc(100dvh-2rem)] max-w-[1200px] flex-col overflow-hidden rounded-[15px] border border-slate-200/70 bg-white/78 shadow-[0_20px_40px_rgba(15,23,42,0.08)]"
      }
    >
        {!embedded ? (
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/70 px-5 py-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-950">运行日志</h1>
              <p className="mt-1 text-sm text-slate-500">邮箱刷新、授权校验和同步结果</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  clearRunLogs();
                  setLogs([]);
                  setServerLogs([]);
                  await fetch("/api/run-logs", { method: "DELETE" }).catch(() => null);
                }}
                disabled={mergedLogs.length === 0}
                className="rounded-[12px] bg-slate-950 px-3 py-2 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-40"
              >
                清空日志
              </button>
            </div>
          </header>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/70 bg-slate-50/60 px-5 py-3">
          <div className="flex flex-wrap gap-2">
            {filterTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveFilter(tab.id)}
                className={`flex items-center gap-2 rounded-[999px] border px-3 py-1.5 text-sm font-semibold transition ${
                  activeFilter === tab.id
                    ? "border-slate-900 bg-slate-950 text-white shadow-sm"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900"
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] ${
                    activeFilter === tab.id ? "bg-white/16 text-white" : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            ))}
          </div>
          {embedded ? (
            <button
              type="button"
              onClick={async () => {
                clearRunLogs();
                setLogs([]);
                setServerLogs([]);
                await fetch("/api/run-logs", { method: "DELETE" }).catch(() => null);
              }}
              disabled={mergedLogs.length === 0}
              className="rounded-[12px] border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              清空日志
            </button>
          ) : null}
        </div>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-5">
          {visibleLogs.length ? (
            <div className="space-y-2">
              {visibleLogs.map((log) => (
                <article
                  key={log.id}
                  className="grid gap-3 rounded-[12px] border border-slate-200/70 bg-white px-4 py-3 md:grid-cols-[140px_92px_minmax(0,1fr)]"
                >
                  <div className="text-sm font-semibold text-slate-500">{formatLogTime(log.at)}</div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <span className={`h-2 w-2 rounded-full ${toneClass(log.tone)}`} aria-hidden="true" />
                    {toneText(log.tone)}
                  </div>
                  <div className="min-w-0">
                    <p className="overflow-wrap-anywhere text-sm font-medium text-slate-800">{log.message}</p>
                    {(log.provider || log.account) && (
                      <p className="mt-1 truncate text-xs text-slate-400">
                        {[log.provider, log.account].filter(Boolean).join(" / ")}
                      </p>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="flex h-full min-h-[320px] items-center justify-center rounded-[15px] border border-dashed border-slate-200 bg-white/70 text-sm font-medium text-slate-400">
              {emptyText}
            </div>
          )}
        </div>
      </section>
  );

  if (embedded) {
    return content;
  }

  return <main className="min-h-[100dvh] overflow-hidden p-4">{content}</main>;
}
