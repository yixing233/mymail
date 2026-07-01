import { getRefreshIntervalSeconds } from "@/lib/app-settings";
import { appendServerRunLog } from "@/lib/server-run-logs";
import { syncAllMailboxes, type SyncAllMailboxesResult } from "@/lib/sync-runner";
import type { ProviderId } from "@/lib/types";

interface AutoRefreshState {
  initialized: boolean;
  intervalSeconds: number;
  timer: ReturnType<typeof setInterval> | null;
  running: boolean;
  nextRunAt?: string;
  lastStartedAt?: string;
  lastFinishedAt?: string;
  lastSummary?: SyncAllMailboxesResult["summary"];
  lastError?: string;
}

const globalForAutoRefresh = globalThis as typeof globalThis & {
  __mymailAutoRefresh?: AutoRefreshState;
};

const providerLabels: Record<ProviderId, string> = {
  gmail: "Gmail",
  outlook: "Outlook",
  qq: "QQ Mail",
  mail163: "163 Mail",
};

function getState() {
  globalForAutoRefresh.__mymailAutoRefresh ??= {
    initialized: false,
    intervalSeconds: 0,
    timer: null,
    running: false,
  };
  return globalForAutoRefresh.__mymailAutoRefresh;
}

function maybeUnref(timer: ReturnType<typeof setInterval>) {
  if (typeof timer === "object" && timer && "unref" in timer) {
    timer.unref();
  }
}

function buildNextRunAt(intervalSeconds: number) {
  return new Date(Date.now() + intervalSeconds * 1000).toISOString();
}

function scheduleNextRun(state: AutoRefreshState, intervalSeconds = state.intervalSeconds) {
  state.nextRunAt = buildNextRunAt(intervalSeconds);
}

async function runScheduledSync() {
  const state = getState();
  if (state.running) {
    appendServerRunLog({
      message: "自动刷新跳过：上一次刷新仍在进行",
      tone: "info",
    });
    return;
  }

  state.running = true;
  state.lastStartedAt = new Date().toISOString();
  state.lastError = undefined;
  appendServerRunLog({
    message: `自动刷新开始，间隔 ${state.intervalSeconds} 秒`,
    tone: "info",
  });

  try {
    const result = await syncAllMailboxes({ trigger: "auto" });
    state.lastSummary = result.summary;
    state.lastFinishedAt = new Date().toISOString();
    for (const item of result.results) {
      const count =
        item.result && typeof item.result === "object" && "count" in item.result
          ? Number((item.result as { count?: unknown }).count ?? 0)
          : 0;
      appendServerRunLog({
        message: item.ok
          ? `自动刷新完成：${item.account}，拉取 ${count} 封`
          : `自动刷新失败：${item.account}，${item.error || "同步失败"}`,
        provider: providerLabels[item.providerId] ?? item.providerId,
        account: item.account,
        tone: item.ok ? "success" : "error",
      });
    }
    appendServerRunLog({
      message: `自动刷新完成：成功 ${result.summary.succeeded} 个，失败 ${result.summary.failed} 个`,
      tone: result.summary.failed > 0 ? "error" : "success",
    });
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : "自动刷新失败";
    state.lastFinishedAt = new Date().toISOString();
    appendServerRunLog({
      message: `自动刷新失败：${state.lastError}`,
      tone: "error",
    });
  } finally {
    state.running = false;
  }
}

export function tickAutoRefreshScheduler() {
  const state = getState();
  const intervalSeconds = getRefreshIntervalSeconds();

  if (intervalSeconds <= 0) {
    return getAutoRefreshStatus();
  }

  if (!state.initialized || state.intervalSeconds !== intervalSeconds) {
    configureAutoRefreshScheduler(intervalSeconds);
    return getAutoRefreshStatus();
  }

  if (!state.nextRunAt) {
    scheduleNextRun(state, intervalSeconds);
    return getAutoRefreshStatus();
  }

  if (Date.now() < Date.parse(state.nextRunAt)) {
    return getAutoRefreshStatus();
  }

  scheduleNextRun(state, intervalSeconds);
  appendServerRunLog({
    message: "自动刷新已触发，开始检查邮箱",
    tone: "info",
  });
  void runScheduledSync();
  return getAutoRefreshStatus();
}

export function configureAutoRefreshScheduler(intervalSeconds = getRefreshIntervalSeconds()) {
  const state = getState();
  const shouldRun = intervalSeconds > 0;
  const timerMatches = Boolean(state.timer) === shouldRun;

  if (state.initialized && state.intervalSeconds === intervalSeconds && timerMatches) {
    return getAutoRefreshStatus();
  }

  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
    appendServerRunLog({
      message: "自动刷新调度已停止",
      tone: "info",
    });
  }

  state.initialized = true;
  state.intervalSeconds = intervalSeconds;
  state.nextRunAt = undefined;

  if (shouldRun) {
    scheduleNextRun(state, intervalSeconds);
    appendServerRunLog({
      message: `自动刷新调度已开启，间隔 ${intervalSeconds} 秒`,
      tone: "info",
    });
    state.timer = setInterval(() => {
      state.nextRunAt = buildNextRunAt(intervalSeconds);
      appendServerRunLog({
        message: "自动刷新已触发，开始检查邮箱",
        tone: "info",
      });
      void runScheduledSync();
    }, intervalSeconds * 1000);
    maybeUnref(state.timer);
  } else {
    appendServerRunLog({
      message: "自动刷新调度已关闭",
      tone: "info",
    });
  }

  return getAutoRefreshStatus();
}

export function ensureAutoRefreshScheduler() {
  return tickAutoRefreshScheduler();
}

export function getAutoRefreshStatus() {
  const state = getState();
  return {
    enabled: state.intervalSeconds > 0 && Boolean(state.timer),
    intervalSeconds: state.intervalSeconds,
    running: state.running,
    nextRunAt: state.nextRunAt,
    lastStartedAt: state.lastStartedAt,
    lastFinishedAt: state.lastFinishedAt,
    lastSummary: state.lastSummary,
    lastError: state.lastError,
  };
}
