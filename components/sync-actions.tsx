"use client";

import { startTransition, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/components/toast";
import type { ProviderId } from "@/lib/types";

type StepStatus = "pending" | "active" | "done" | "error";

interface RefreshStep {
  id: string;
  label: string;
  detail: string;
  status: StepStatus;
}

interface SyncMailboxResult {
  providerId: ProviderId;
  mailboxId: string;
  account: string;
  ok: boolean;
  result?: { count?: number };
  error?: string;
}

interface SyncAllResponse {
  summary: {
    total: number;
    succeeded: number;
    failed: number;
  };
  results: SyncMailboxResult[];
}

const refreshSteps: RefreshStep[] = [
  { id: "queue", label: "创建刷新任务", detail: "准备当前邮箱范围", status: "pending" },
  { id: "auth", label: "校验登录凭据", detail: "检查 OAuth token 或 IMAP 授权", status: "pending" },
  { id: "connect", label: "连接邮箱服务器", detail: "打开收件箱 INBOX", status: "pending" },
  { id: "fetch", label: "读取最近邮件", detail: "拉取正文、未读状态和附件信息", status: "pending" },
  { id: "write", label: "写入本地缓存", detail: "更新列表和详情数据", status: "pending" },
];

function buildSteps(activeIndex: number, error?: string, finalDetail?: string) {
  return refreshSteps.map((step, index) => {
    const isLast = index === refreshSteps.length - 1;
    return {
      ...step,
      detail: isLast && finalDetail ? finalDetail : step.detail,
      status: error && index === activeIndex
        ? "error"
        : index < activeIndex
          ? "done"
          : index === activeIndex
            ? "active"
            : "pending",
    } satisfies RefreshStep;
  });
}

function completeSteps(finalDetail: string) {
  return refreshSteps.map((step, index) => ({
    ...step,
    detail: index === refreshSteps.length - 1 ? finalDetail : step.detail,
    status: "done",
  }) satisfies RefreshStep);
}

function extractCount(payload: unknown) {
  if (!payload || typeof payload !== "object") return undefined;
  const count = (payload as { count?: unknown }).count;
  return typeof count === "number" ? count : undefined;
}

function formatSyncedCount(count: number) {
  return count > 0 ? `已同步 ${count} 封邮件` : "未拉取到邮件";
}

function isTerminalSteps(steps: RefreshStep[]) {
  return steps.every((step) => step.status === "done") || steps.some((step) => step.status === "error");
}

function ProgressDot({ status }: { status: StepStatus }) {
  return (
    <span
      className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[9px] transition ${
        status === "done"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : status === "active"
            ? "border-sky-200 bg-sky-50 text-sky-700"
            : status === "error"
              ? "border-rose-200 bg-rose-50 text-rose-700"
              : "border-slate-200 bg-white text-slate-400"
      }`}
    >
      {status === "done" ? (
        <i className="fa-solid fa-check" aria-hidden="true" />
      ) : status === "error" ? (
        <i className="fa-solid fa-xmark" aria-hidden="true" />
      ) : status === "active" ? (
        <i className="fa-solid fa-circle-notch fa-spin" aria-hidden="true" />
      ) : (
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
      )}
    </span>
  );
}

export function SyncActions({
  source,
  mailboxId,
  label,
  totalMessages,
}: {
  source: ProviderId | "all";
  mailboxId?: string;
  label: string;
  totalMessages: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const searchParams = useSearchParams();
  const searchParam = searchParams.get("search") ?? "";

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [steps, setSteps] = useState<RefreshStep[] | null>(null);
  const [syncResults, setSyncResults] = useState<SyncMailboxResult[] | null>(null);
  const [summaryText, setSummaryText] = useState<string | null>(null);
  const [autoCloseSeconds, setAutoCloseSeconds] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);

  const [isSearchOpen, setIsSearchOpen] = useState(!!searchParam);
  const [searchQuery, setSearchQuery] = useState(searchParam);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setSearchQuery(searchParam);
    if (searchParam) {
      setIsSearchOpen(true);
    }
  }, [searchParam]);

  useEffect(() => {
    const delayDebounceId = setTimeout(() => {
      const nextParams = new URLSearchParams(window.location.search);
      if (searchQuery) {
        nextParams.set("search", searchQuery);
      } else {
        nextParams.delete("search");
      }
      const nextQuery = nextParams.toString();
      const currentQuery = window.location.search.replace(/^\?/, "");
      if (nextQuery !== currentQuery) {
        router.push(`/?${nextQuery}`);
      }
    }, 300);

    return () => clearTimeout(delayDebounceId);
  }, [searchQuery, router]);

  useEffect(() => {
    if (!steps || isRefreshing || !isTerminalSteps(steps)) {
      setAutoCloseSeconds(null);
      return;
    }

    setAutoCloseSeconds(4);
    const countdownId = window.setInterval(() => {
      setAutoCloseSeconds((seconds) => {
        if (!seconds || seconds <= 1) return seconds;
        return seconds - 1;
      });
    }, 1000);
    const closeId = window.setTimeout(() => {
      setSteps(null);
      setSyncResults(null);
      setSummaryText(null);
      setAutoCloseSeconds(null);
    }, 4000);

    return () => {
      window.clearInterval(countdownId);
      window.clearTimeout(closeId);
    };
  }, [steps, isRefreshing]);

  function handleCloseSearch() {
    setSearchQuery("");
    setIsSearchOpen(false);
  }

  function stageProgress(index: number, detail?: string) {
    setSteps(buildSteps(index, undefined, detail));
  }

  async function refreshCurrent() {
    setIsRefreshing(true);
    setSyncResults(null);
    setSummaryText(null);
    setAutoCloseSeconds(null);
    stageProgress(0);

    try {
      await new Promise((resolve) => window.setTimeout(resolve, 180));
      stageProgress(1);
      await new Promise((resolve) => window.setTimeout(resolve, 180));
      stageProgress(2);
      await new Promise((resolve) => window.setTimeout(resolve, 180));
      stageProgress(3);

      if (source === "all") {
        const response = await fetch("/api/sync", { method: "POST" });
        if (!response.ok) throw new Error("刷新失败");
        const payload = (await response.json()) as SyncAllResponse;
        setSyncResults(payload.results);
        const fetchedCount = payload.results.reduce((total, result) => total + (result.result?.count ?? 0), 0);
        const finalDetail = `成功 ${payload.summary.succeeded} 个，失败 ${payload.summary.failed} 个，拉取 ${fetchedCount} 封`;
        setSteps(completeSteps(finalDetail));
        setSummaryText(
          payload.summary.failed > 0
            ? `全部邮箱刷新完成：${payload.summary.succeeded}/${payload.summary.total} 成功，${payload.summary.failed} 个失败`
            : `全部邮箱刷新完成，${formatSyncedCount(fetchedCount)}`,
        );
        if (payload.summary.failed > 0) {
          toast.error(`刷新完成，但 ${payload.summary.failed} 个邮箱失败`);
        } else {
          toast.success(`全部邮箱刷新完成，${formatSyncedCount(fetchedCount)}`);
        }
      } else if (!mailboxId) {
        const response = await fetch(`/api/providers/${source}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action: "refresh" }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(payload?.error || "刷新失败");
        }
        const payload = (await response.json()) as SyncAllResponse;
        setSyncResults(payload.results);
        const fetchedCount = payload.results.reduce((total, result) => total + (result.result?.count ?? 0), 0);
        const finalDetail = `成功 ${payload.summary.succeeded} 个，失败 ${payload.summary.failed} 个，拉取 ${fetchedCount} 封`;
        setSteps(completeSteps(finalDetail));
        setSummaryText(
          payload.summary.failed > 0
            ? `${label} 刷新完成：${payload.summary.succeeded}/${payload.summary.total} 成功，${payload.summary.failed} 个失败`
            : `${label} 刷新完成，${formatSyncedCount(fetchedCount)}`,
        );
        if (payload.summary.failed > 0) {
          toast.error(`刷新完成，但 ${payload.summary.failed} 个邮箱失败`);
        } else {
          toast.success(`${label} 刷新完成，${formatSyncedCount(fetchedCount)}`);
        }
      } else {
        const response = await fetch(`/api/providers/${source}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action: "refresh", mailboxId }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(payload?.error || "刷新失败");
        }
        const payload = await response.json();
        const count = extractCount((payload as { result?: unknown }).result);
        const finalDetail = typeof count === "number" ? formatSyncedCount(count) : `已刷新 ${label}`;
        setSteps(completeSteps(finalDetail));
        setSummaryText(typeof count === "number" ? `${label} 刷新完成，${finalDetail}` : `${label} 刷新完成`);
        toast.success(`${label} 刷新完成，${finalDetail}`);
      }

      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "刷新失败";
      setSteps(buildSteps(3, message));
      setSummaryText(message);
      toast.error(message);
    } finally {
      setIsRefreshing(false);
    }
  }

  async function markAllRead() {
    try {
      const response = await fetch("/api/inbox", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ source, mailbox: mailboxId }),
      });
      if (!response.ok) throw new Error("标记已读失败");
      toast.success("已将当前视图邮件全部标记为已读");
      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
    }
  }

  return (
    <div className="mt-1 w-full">
      <div className="flex min-h-[32px] items-center justify-between text-xs leading-none text-slate-500">
      <div className="flex flex-1 items-center min-w-0 mr-4">
        {isSearchOpen ? (
          <div className="relative flex-1 max-w-[280px] animate-in fade-in zoom-in-95 duration-200">
            <span className="absolute inset-y-0 left-0 flex items-center pl-2.5 pointer-events-none text-slate-400">
              <i className="fa-solid fa-magnifying-glass text-[11px]" aria-hidden="true" />
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="搜索主题、发件人或内容..."
              className="w-full rounded-[12px] border border-slate-200 bg-white/70 py-1.5 pl-7 pr-7 text-xs text-slate-700 outline-none transition focus:border-slate-400 focus:bg-white"
              autoFocus
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-slate-400 hover:text-slate-600"
                aria-label="清空搜索"
              >
                <i className="fa-solid fa-xmark text-[11px]" aria-hidden="true" />
              </button>
            )}
          </div>
        ) : (
          <p className="truncate text-slate-500 animate-in fade-in duration-200">
            {totalMessages} 封邮件
          </p>
        )}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={() => {
            if (isSearchOpen) {
              handleCloseSearch();
            } else {
              setIsSearchOpen(true);
            }
          }}
          aria-label={isSearchOpen ? "关闭搜索" : "展开搜索"}
          title={isSearchOpen ? "关闭搜索" : "展开搜索"}
          className={`grid h-8 w-8 place-items-center rounded-[12px] transition ${
            isSearchOpen
              ? "bg-slate-100 text-slate-900"
              : "bg-white/0 text-slate-700 hover:bg-slate-100"
          }`}
        >
          <i
            className={`fa-solid ${isSearchOpen ? "fa-xmark" : "fa-magnifying-glass"} text-xs`}
            aria-hidden="true"
          />
        </button>

        <button
          type="button"
          onClick={markAllRead}
          aria-label="一键已读"
          title="一键已读"
          className="grid h-8 w-8 place-items-center rounded-[12px] bg-white/0 text-slate-700 transition hover:bg-slate-100"
        >
          <i className="fa-solid fa-envelope-open text-[11px]" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={refreshCurrent}
          disabled={isRefreshing}
          aria-label="刷新当前邮箱"
          title="刷新当前邮箱"
          className="grid h-8 w-8 place-items-center rounded-[12px] bg-white/0 text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <i
            className={`fa-solid fa-rotate text-sm ${isRefreshing ? "fa-spin" : ""}`}
            aria-hidden="true"
          />
        </button>
      </div>
      </div>
      {mounted && steps
        ? createPortal(
            <div className="fixed bottom-4 right-4 z-50 w-[min(420px,calc(100vw-2rem))] pointer-events-none">
              <div className="pointer-events-auto overflow-hidden rounded-[16px] border border-slate-200/80 bg-white/92 shadow-[0_18px_60px_rgba(15,23,42,0.16)] backdrop-blur-md animate-in slide-in-from-bottom-3 fade-in duration-200">
                <div className="flex items-center justify-between border-b border-slate-200/70 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-slate-900">{summaryText || "正在刷新邮件"}</p>
                    <p className="mt-0.5 truncate text-[11px] text-slate-400">{source === "all" ? "全部邮箱" : label}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSteps(null);
                      setSyncResults(null);
                      setSummaryText(null);
                      setAutoCloseSeconds(null);
                    }}
                    className="grid h-7 w-7 place-items-center rounded-[10px] text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                    aria-label="关闭刷新详情"
                  >
                    <i className="fa-solid fa-xmark text-[11px]" aria-hidden="true" />
                  </button>
                </div>

                <div className="grid gap-1 px-3 py-2">
                  {steps.map((step) => (
                    <div key={step.id} className="flex gap-2 py-1">
                      <ProgressDot status={step.status} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <p className="truncate text-xs font-semibold text-slate-800">{step.label}</p>
                          <p className="text-[10px] font-semibold text-slate-400">
                            {step.status === "done"
                              ? "完成"
                              : step.status === "active"
                                ? "进行中"
                                : step.status === "error"
                                  ? "失败"
                                  : "等待"}
                          </p>
                        </div>
                        <p className={`mt-0.5 truncate text-[11px] ${step.status === "error" ? "text-rose-500" : "text-slate-400"}`}>
                          {step.detail}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                {syncResults?.length ? (
                  <div className="max-h-36 overflow-y-auto border-t border-slate-200/70 px-3 py-2">
                    {syncResults.map((result) => (
                      <div key={`${result.providerId}-${result.mailboxId}`} className="flex items-center justify-between gap-3 py-1 text-[11px]">
                        <div className="min-w-0 flex items-center gap-2">
                          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${result.ok ? "bg-emerald-500" : "bg-rose-500"}`} />
                          <span className="truncate font-medium text-slate-700">{result.account}</span>
                        </div>
                        <span className={`shrink-0 font-semibold ${result.ok ? "text-emerald-700" : "text-rose-600"}`}>
                          {result.ok ? `${result.result?.count ?? 0} 封` : result.error || "失败"}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
                {autoCloseSeconds ? (
                  <div className="border-t border-slate-200/70 px-3 py-2 text-right text-[11px] font-medium text-slate-400">
                    {autoCloseSeconds} 秒后自动关闭
                  </div>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
