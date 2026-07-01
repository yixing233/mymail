"use client";

import { startTransition, useEffect, useState, type ChangeEvent } from "react";
import { useToast } from "@/components/toast";
import { useRouter, useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";
import { useContextMenu } from "@/components/context-menu";
import { DialogTransition } from "@/components/dialog-transition";
import { appendRunLog } from "@/lib/run-logs";
import type { MailMailbox, MailProviderGroup, ProviderId } from "@/lib/types";

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

interface ProviderConfigState {
  providerId: ProviderId;
  mailboxId?: string;
  mode: "oauth" | "imap";
  account: string;
  authState: string;
  syncHealth: string;
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

interface ProviderTokenState {
  accessToken?: string;
  refreshToken?: string;
  tokenType?: string;
  expiryDate?: number;
}

interface AutoRefreshStatus {
  enabled: boolean;
  intervalSeconds: number;
  running: boolean;
  nextRunAt?: string;
}

interface AppSettingsResponse {
  refreshInterval: number;
  notificationsEnabled?: boolean;
  singleSyncFetchLimit: number;
  bulkSyncFetchLimit: number;
  autoSyncFetchLimit: number;
  autoRefresh?: AutoRefreshStatus;
}

interface BackupExportResponse {
  version: 1;
  exportedAt: string;
  appSettings: unknown[];
  providers: unknown[];
  messages: unknown[];
}

interface BackupImportResponse {
  success: boolean;
  mode: "replace" | "merge";
  appSettingsCount: number;
  providersCount: number;
  messagesCount: number;
}

interface OutlookImportResponse {
  imported: number;
  updated: number;
  mailboxes: Array<{ id: string; account: string }>;
  errors: string[];
}

interface OAuthStartResponse {
  authorizeUrl: string;
  openedInChrome?: boolean;
  chromeError?: string;
}

interface ChromeProfileOption {
  directory: string;
  name: string;
  email: string;
  label: string;
  isLastUsed: boolean;
}

interface DeleteMailboxTarget {
  provider: MailProviderGroup;
  mailbox: MailMailbox;
  mode?: "delete" | "clear" | "clear-all";
}

type OutlookDialogTab = "oauth" | "import";

const refreshIntervalOptions = [
  { value: 0, label: "关闭自动刷新" },
  { value: 300, label: "每 5 分钟" },
  { value: 600, label: "每 10 分钟" },
  { value: 1800, label: "每 30 分钟" },
];

const providerRefreshSteps: RefreshStep[] = [
  { id: "queue", label: "创建刷新任务", detail: "准备当前邮箱类型", status: "pending" },
  { id: "mailboxes", label: "枚举邮箱地址", detail: "读取该类型下所有账号", status: "pending" },
  { id: "connect", label: "连接邮箱服务", detail: "逐个校验凭据并打开收件箱", status: "pending" },
  { id: "fetch", label: "读取最近邮件", detail: "拉取正文、未读状态和附件信息", status: "pending" },
  { id: "write", label: "写入本地缓存", detail: "更新列表和详情数据", status: "pending" },
];

const accountRefreshSteps: RefreshStep[] = [
  { id: "connect", label: "连接账号", detail: "校验凭据并打开收件箱", status: "pending" },
  { id: "fetch", label: "获取邮件", detail: "拉取正文、未读状态和附件信息", status: "pending" },
  { id: "write", label: "写入缓存", detail: "更新本地邮件列表", status: "pending" },
];

function buildProviderSteps(activeIndex: number, error?: string, detail?: string) {
  return providerRefreshSteps.map((step, index) => ({
    ...step,
    detail: error && index === activeIndex
      ? error
      : index === activeIndex && detail
        ? detail
        : step.detail,
    status: error && index === activeIndex
      ? "error"
      : index < activeIndex
        ? "done"
        : index === activeIndex
          ? "active"
          : "pending",
  }) satisfies RefreshStep);
}

function buildAccountSteps(activeIndex: number, error?: string, detail?: string) {
  return accountRefreshSteps.map((step, index) => ({
    ...step,
    detail: error && index === activeIndex
      ? error
      : index === activeIndex && detail
        ? detail
        : step.detail,
    status: error && index === activeIndex
      ? "error"
      : index < activeIndex
        ? "done"
        : index === activeIndex
          ? "active"
          : "pending",
  }) satisfies RefreshStep);
}

function completeProviderSteps(finalDetail: string) {
  return providerRefreshSteps.map((step, index) => ({
    ...step,
    detail: index === providerRefreshSteps.length - 1 ? finalDetail : step.detail,
    status: "done",
  }) satisfies RefreshStep);
}

function completeAccountSteps(finalDetail: string) {
  return accountRefreshSteps.map((step, index) => ({
    ...step,
    detail: index === accountRefreshSteps.length - 1 ? finalDetail : step.detail,
    status: "done",
  }) satisfies RefreshStep);
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

function stepStatusText(status: StepStatus) {
  if (status === "done") return "完成";
  if (status === "active") return "进行中";
  if (status === "error") return "失败";
  return "等待";
}

function getProviderIcon(providerId: string) {
  switch (providerId) {
    case "gmail":
      return "fa-brands fa-google";
    case "outlook":
      return "fa-brands fa-microsoft";
    case "qq":
      return "fa-brands fa-qq";
    case "mail163":
      return "fa-solid fa-envelope";
    default:
      return "fa-solid fa-envelope";
  }
}

function getDefaultImapHost(providerId: ProviderId) {
  if (providerId === "outlook") return "outlook.office365.com";
  if (providerId === "mail163") return "imap.163.com";
  if (providerId === "qq") return "imap.qq.com";
  return "";
}

function isProviderDefaultImapHost(value: string | undefined) {
  return !value || ["outlook.office365.com", "imap.qq.com", "imap.163.com"].includes(value);
}

function formatCountdown(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function ProvidersPanel({ providers }: { providers: MailProviderGroup[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const selectedSource = (params.get("source") as ProviderId | "all" | null) ?? "all";
  const selectedMailbox = params.get("mailbox");
  const [optimisticSelection, setOptimisticSelection] = useState<{
    source: ProviderId | "all";
    mailboxId?: string;
  } | null>(null);
  const [configProvider, setConfigProvider] = useState<MailProviderGroup | null>(null);
  const [configMailbox, setConfigMailbox] = useState<MailMailbox | null>(null);
  const toast = useToast();
  const { showMenu } = useContextMenu();
  const [configMode, setConfigMode] = useState<"create" | "edit">("create");
  const [pendingProviderId, setPendingProviderId] = useState<ProviderId | null>(null);
  const [configState, setConfigState] = useState<ProviderConfigState | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [configDeleting, setConfigDeleting] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteMailboxTarget, setDeleteMailboxTarget] = useState<DeleteMailboxTarget | null>(null);
  const [deleteMailboxPending, setDeleteMailboxPending] = useState(false);
  const [oauthRedirecting, setOauthRedirecting] = useState(false);
  const [outlookDialogTab, setOutlookDialogTab] = useState<OutlookDialogTab>("oauth");
  const [outlookImportValue, setOutlookImportValue] = useState("");
  const [outlookImportSaving, setOutlookImportSaving] = useState(false);
  const [tokensVisible, setTokensVisible] = useState(false);
  const [tokensLoading, setTokensLoading] = useState(false);
  const [providerTokens, setProviderTokens] = useState<ProviderTokenState | null>(null);
  const [chromeProfiles, setChromeProfiles] = useState<ChromeProfileOption[]>([]);
  const [chromeProfilesLoading, setChromeProfilesLoading] = useState(false);
  const [selectedChromeProfile, setSelectedChromeProfile] = useState("");
  const [portalReady, setPortalReady] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState<number>(0);
  const [isSelectOpen, setIsSelectOpen] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [backupFileName, setBackupFileName] = useState("");
  const [backupPayload, setBackupPayload] = useState<BackupExportResponse | null>(null);
  const [backupExporting, setBackupExporting] = useState(false);
  const [backupImportingMode, setBackupImportingMode] = useState<"replace" | "merge" | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [singleSyncFetchLimit, setSingleSyncFetchLimit] = useState(3);
  const [bulkSyncFetchLimit, setBulkSyncFetchLimit] = useState(3);
  const [autoSyncFetchLimit, setAutoSyncFetchLimit] = useState(3);
  const [draftSingleSyncFetchLimit, setDraftSingleSyncFetchLimit] = useState("3");
  const [draftBulkSyncFetchLimit, setDraftBulkSyncFetchLimit] = useState("3");
  const [draftAutoSyncFetchLimit, setDraftAutoSyncFetchLimit] = useState("3");
  const [syncFetchLimitSaving, setSyncFetchLimitSaving] = useState(false);
  const [autoRefreshRunning, setAutoRefreshRunning] = useState(false);
  const [autoRefreshNextRunAt, setAutoRefreshNextRunAt] = useState<string | null>(null);
  const [countdownNow, setCountdownNow] = useState(() => Date.now());
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">("default");
  const [notificationSaving, setNotificationSaving] = useState(false);
  const [refreshProviderLabel, setRefreshProviderLabel] = useState<string | null>(null);
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const [openProviderIds, setOpenProviderIds] = useState<ProviderId[]>(() =>
    selectedSource !== "all" ? [selectedSource] : [],
  );
  const [refreshSteps, setRefreshSteps] = useState<RefreshStep[] | null>(null);
  const [refreshResults, setRefreshResults] = useState<SyncMailboxResult[] | null>(null);
  const [refreshSummaryText, setRefreshSummaryText] = useState<string | null>(null);
  const [refreshAccountLabel, setRefreshAccountLabel] = useState<string | null>(null);
  const [refreshAccountSteps, setRefreshAccountSteps] = useState<RefreshStep[] | null>(null);
  const [refreshAutoCloseSeconds, setRefreshAutoCloseSeconds] = useState<number | null>(null);
  const isLogsView = params.get("view") === "logs";
  const activeSource = optimisticSelection?.source ?? selectedSource;
  const activeMailbox = optimisticSelection?.mailboxId ?? selectedMailbox;
  const isMailboxSelectionActive = true;



  useEffect(() => {
    setPortalReady(true);
    setNotificationPermission("Notification" in window ? Notification.permission : "unsupported");
    void loadSettings();
  }, []);

  useEffect(() => {
    setOptimisticSelection(null);
  }, [selectedSource, selectedMailbox]);

  useEffect(() => {
    if (selectedSource === "all") {
      return;
    }

    setOpenProviderIds((current) => (current.includes(selectedSource) ? current : [...current, selectedSource]));
  }, [selectedSource]);

  useEffect(() => {
    if (refreshInterval <= 0 || !autoRefreshNextRunAt) return;

    const timerId = window.setInterval(() => {
      setCountdownNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timerId);
    };
  }, [autoRefreshNextRunAt, refreshInterval]);

  useEffect(() => {
    if (refreshInterval <= 0 || !autoRefreshNextRunAt) return;

    const nextRunMs = Date.parse(autoRefreshNextRunAt);
    if (Number.isNaN(nextRunMs) || countdownNow < nextRunMs) return;

    const intervalMs = refreshInterval * 1000;
    const elapsedIntervals = Math.floor((countdownNow - nextRunMs) / intervalMs) + 1;
    setAutoRefreshNextRunAt(new Date(nextRunMs + elapsedIntervals * intervalMs).toISOString());
  }, [autoRefreshNextRunAt, countdownNow, refreshInterval]);

  useEffect(() => {
    if (refreshInterval <= 0) {
      setAutoRefreshNextRunAt(null);
      return;
    }

    if (!autoRefreshNextRunAt) {
      setAutoRefreshNextRunAt(new Date(Date.now() + refreshInterval * 1000).toISOString());
      setCountdownNow(Date.now());
    }
  }, [autoRefreshNextRunAt, refreshInterval]);

  useEffect(() => {
    const base = new URLSearchParams(params.toString());
    base.delete("message");
    base.delete("view");

    const allParams = new URLSearchParams(base);
    allParams.set("source", "all");
    allParams.delete("mailbox");
    router.prefetch(`/?${allParams.toString()}`);

    for (const provider of providers) {
      for (const mailbox of provider.mailboxes) {
        const next = new URLSearchParams(base);
        next.set("source", provider.id);
        next.set("mailbox", mailbox.id);
        router.prefetch(`/?${next.toString()}`);
      }
    }
  }, [params, providers, router]);

  useEffect(() => {
    const handleOpenSettings = () => {
      setIsSettingsOpen(true);
      void loadSettings();
    };
    window.addEventListener("open-settings", handleOpenSettings);
    return () => {
      window.removeEventListener("open-settings", handleOpenSettings);
    };
  }, []);

  useEffect(() => {
    function handleOAuthResult(rawValue: string | null) {
      if (!rawValue) return;

      try {
        const payload = JSON.parse(rawValue) as {
          providerId?: string;
          status?: "success" | "error";
          message?: string;
        };
        if (payload.status === "success") {
          toast.success(`${payload.providerId || "邮箱"} 授权成功`);
          startTransition(() => {
            router.refresh();
          });
        } else if (payload.status === "error") {
          toast.error(payload.message || "授权失败");
        }
      } catch {
        toast.error("授权结果读取失败");
      } finally {
        window.localStorage.removeItem("mymail:oauth-result");
      }
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key === "mymail:oauth-result") {
        handleOAuthResult(event.newValue);
      }
    };

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.type !== "mymail:oauth-result") {
        return;
      }
      handleOAuthResult(JSON.stringify(event.data.payload));
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener("message", handleMessage);
    handleOAuthResult(window.localStorage.getItem("mymail:oauth-result"));

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("message", handleMessage);
    };
  }, [router, toast]);

  useEffect(() => {
    if (!refreshSteps || pendingProviderId || !isTerminalSteps(refreshSteps)) {
      setRefreshAutoCloseSeconds(null);
      return;
    }

    setRefreshAutoCloseSeconds(4);
    const countdownId = window.setInterval(() => {
      setRefreshAutoCloseSeconds((seconds) => {
        if (!seconds || seconds <= 1) return seconds;
        return seconds - 1;
      });
    }, 1000);
    const closeId = window.setTimeout(() => {
      setRefreshSteps(null);
      setRefreshResults(null);
      setRefreshSummaryText(null);
      setRefreshProviderLabel(null);
      setRefreshAccountLabel(null);
      setRefreshAccountSteps(null);
      setRefreshAutoCloseSeconds(null);
    }, 4000);

    return () => {
      window.clearInterval(countdownId);
      window.clearTimeout(closeId);
    };
  }, [refreshSteps, pendingProviderId]);

  useEffect(() => {
    if (!configProvider) {
      setConfigState(null);
      setConfigMailbox(null);
      setChromeProfiles([]);
      setSelectedChromeProfile("");
      return;
    }

    if (configMode === "create") {
      setConfigLoading(false);
      if (configProvider.id === "gmail") {
        void loadChromeProfiles();
      } else {
        setChromeProfiles([]);
        setSelectedChromeProfile("");
      }
      return;
    }

    let alive = true;
    setConfigLoading(true);

    const query = configMode === "edit" && configMailbox
      ? `?mailboxId=${encodeURIComponent(configMailbox.id)}`
      : "";

    fetch(`/api/providers/${configProvider.id}${query}`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("读取配置失败");
        }
        return (await response.json()) as ProviderConfigState;
      })
      .then((data) => {
        if (!alive) return;
        setConfigState(data);
        if (configProvider.id === "gmail") {
          void loadChromeProfiles(data.account);
        } else {
          setChromeProfiles([]);
          setSelectedChromeProfile("");
        }
      })
      .catch((error) => {
        if (!alive) return;
        toast.error(error instanceof Error ? error.message : "读取配置失败");
        setConfigProvider(null);
        setConfigMailbox(null);
      })
      .finally(() => {
        if (!alive) return;
        setConfigLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [configMailbox, configMode, configProvider]);

  function setSource(source: ProviderId | "all") {
    const next = new URLSearchParams(params.toString());
    next.set("source", source);
    if (source === "all") {
      next.delete("mailbox");
    }
    next.delete("message");
    next.delete("view");
    setOptimisticSelection({ source, mailboxId: source === "all" ? undefined : selectedMailbox ?? undefined });
    startTransition(() => {
      router.push(`/?${next.toString()}`);
    });
    setMobilePanelOpen(false);
  }

  function setMailboxSource(source: ProviderId, mailboxId: string) {
    setOpenProviderIds((current) => (current.includes(source) ? current : [...current, source]));
    const next = new URLSearchParams(params.toString());
    next.set("source", source);
    next.set("mailbox", mailboxId);
    next.delete("message");
    next.delete("view");
    setOptimisticSelection({ source, mailboxId });
    startTransition(() => {
      router.push(`/?${next.toString()}`);
    });
    setMobilePanelOpen(false);
  }

  function openRunLogs() {
    const next = new URLSearchParams(params.toString());
    next.set("view", "logs");
    startTransition(() => {
      router.push(`/?${next.toString()}`);
    });
    setMobilePanelOpen(false);
  }

  function closeConfig() {
    setConfigProvider(null);
    setConfigMailbox(null);
    setConfigMode("create");
    setConfigState(null);
    setConfigLoading(false);
    setConfigSaving(false);
    setConfigDeleting(false);
    setDeleteConfirmOpen(false);
    setOauthRedirecting(false);
    setTokensVisible(false);
    setTokensLoading(false);
    setProviderTokens(null);
    setChromeProfiles([]);
    setChromeProfilesLoading(false);
    setSelectedChromeProfile("");
    setOutlookDialogTab("oauth");
    setOutlookImportSaving(false);
    setOutlookImportValue("");
  }

  function selectBestChromeProfile(profiles: ChromeProfileOption[], preferredEmail?: string) {
    const normalizedEmail = preferredEmail?.trim().toLowerCase();
    const matched = normalizedEmail
      ? profiles.find((profile) => profile.email.toLowerCase() === normalizedEmail)
      : undefined;
    return matched?.directory || profiles.find((profile) => profile.isLastUsed)?.directory || profiles[0]?.directory || "";
  }

  async function loadChromeProfiles(preferredEmail?: string) {
    setChromeProfilesLoading(true);
    try {
      const response = await fetch("/api/chrome-profiles", { cache: "no-store" });
      if (!response.ok) {
        throw new Error("读取 Chrome 账号失败");
      }
      const payload = (await response.json()) as { profiles?: ChromeProfileOption[] };
      const profiles = payload.profiles ?? [];
      setChromeProfiles(profiles);
      setSelectedChromeProfile((current) => current || selectBestChromeProfile(profiles, preferredEmail));
    } catch {
      setChromeProfiles([]);
      setSelectedChromeProfile("");
    } finally {
      setChromeProfilesLoading(false);
    }
  }

  function openDeleteMailboxDialog(provider: MailProviderGroup, mailbox: MailMailbox) {
    setDeleteMailboxTarget({ provider, mailbox, mode: "delete" });
    setDeleteMailboxPending(false);
  }

  function openClearMailboxDialog(provider: MailProviderGroup, mailbox: MailMailbox) {
    setDeleteMailboxTarget({ provider, mailbox, mode: "clear" });
    setDeleteMailboxPending(false);
  }

  function openClearAllMessagesDialog() {
    setDeleteMailboxTarget({
      provider: providers[0] ?? {
        id: "gmail",
        label: "全部邮箱",
        mode: "oauth",
        unreadCount: 0,
        lastSyncedAt: "未同步",
        accent: "var(--gmail)",
        authHint: "",
        mailboxes: [],
      },
      mailbox: {
        id: "__all_mailboxes__",
        providerId: "gmail",
        account: "所有邮箱账号",
        status: "connected",
        health: "healthy",
        unreadCount: 0,
        lastSyncedAt: "未同步",
      },
      mode: "clear-all",
    });
    setDeleteMailboxPending(false);
  }

  function closeDeleteMailboxDialog() {
    if (deleteMailboxPending) return;
    setDeleteMailboxTarget(null);
  }

  async function handleProviderAction(provider: MailProviderGroup, action: "refresh" | "reconnect") {
    setPendingProviderId(provider.id);
    if (action === "refresh") {
      setRefreshProviderLabel(provider.label);
      setRefreshResults(null);
      setRefreshSummaryText(`${provider.label} 正在刷新`);
      setRefreshAccountLabel(null);
      setRefreshAccountSteps(null);
      setRefreshAutoCloseSeconds(null);
      setRefreshSteps(buildProviderSteps(0, undefined, `${provider.mailboxes.length} 个邮箱账号`));
      appendRunLog({
        message: `${provider.label} 开始批量刷新，${provider.mailboxes.length} 个账号`,
        provider: provider.label,
        tone: "info",
      });
    }

    try {
      if (action === "refresh") {
        if (provider.mailboxes.length === 0) {
          throw new Error("暂无可刷新的邮箱账号");
        }

        await new Promise((resolve) => window.setTimeout(resolve, 160));
        setRefreshSteps(buildProviderSteps(1, undefined, `${provider.mailboxes.length} 个邮箱账号`));

        const results: SyncMailboxResult[] = [];
        for (const [index, mailbox] of provider.mailboxes.entries()) {
          appendRunLog({
            message: `${provider.label} 正在刷新 ${mailbox.account} (${index + 1}/${provider.mailboxes.length})`,
            provider: provider.label,
            account: mailbox.account,
            tone: "info",
          });
          setRefreshAccountLabel(mailbox.account);
          setRefreshAccountSteps(buildAccountSteps(0, undefined, "校验凭据并连接邮箱"));
          setRefreshSummaryText(`${provider.label} 正在刷新 ${index + 1}/${provider.mailboxes.length}`);
          setRefreshSteps(buildProviderSteps(2, undefined, `正在刷新 ${mailbox.account}`));

          await new Promise((resolve) => window.setTimeout(resolve, 120));
          setRefreshAccountSteps(buildAccountSteps(1, undefined, "拉取正文、未读状态和附件信息"));

          const response = await fetch(`/api/providers/${provider.id}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ action, mailboxId: mailbox.id }),
          });

          if (!response.ok) {
            const payload = (await response.json().catch(() => null)) as { error?: string } | null;
            const message = payload?.error || "刷新失败";
            const result = {
              providerId: provider.id,
              mailboxId: mailbox.id,
              account: mailbox.account,
              ok: false,
              error: message,
            } satisfies SyncMailboxResult;
            results.push(result);
            setRefreshResults([...results]);
            setRefreshAccountSteps(buildAccountSteps(1, message));
            appendRunLog({
              message: `${mailbox.account} 刷新失败：${message}`,
              provider: provider.label,
              account: mailbox.account,
              tone: "error",
            });
            continue;
          }

          const payload = (await response.json()) as { result?: { count?: number } };
          const count = payload.result?.count ?? 0;
          const result = {
            providerId: provider.id,
            mailboxId: mailbox.id,
            account: mailbox.account,
            ok: true,
            result: { count },
          } satisfies SyncMailboxResult;
          results.push(result);
          setRefreshResults([...results]);
          setRefreshAccountSteps(completeAccountSteps(`拉取 ${count} 封`));
          appendRunLog({
            message: `${mailbox.account} 刷新完成，拉取 ${count} 封`,
            provider: provider.label,
            account: mailbox.account,
            tone: "success",
          });
        }

        const succeeded = results.filter((result) => result.ok).length;
        const failed = results.length - succeeded;
        const fetchedCount = results.reduce((total, result) => total + (result.result?.count ?? 0), 0);
        const finalDetail = `成功 ${succeeded} 个，失败 ${failed} 个，拉取 ${fetchedCount} 封`;
        setRefreshSteps(completeProviderSteps(finalDetail));
        setRefreshSummaryText(
          failed > 0
            ? `${provider.label} 刷新完成：${succeeded}/${results.length} 成功，${failed} 个失败`
            : `${provider.label} 刷新完成，${formatSyncedCount(fetchedCount)}`,
        );
        if (failed > 0) {
          toast.error(`刷新完成，但 ${failed} 个邮箱失败`);
          appendRunLog({
            message: `${provider.label} 批量刷新完成：成功 ${succeeded} 个，失败 ${failed} 个，拉取 ${fetchedCount} 封`,
            provider: provider.label,
            tone: "error",
          });
        } else {
          toast.success(`${provider.label} 刷新完成，${formatSyncedCount(fetchedCount)}`);
          appendRunLog({
            message: `${provider.label} 批量刷新完成，${formatSyncedCount(fetchedCount)}`,
            provider: provider.label,
            tone: "success",
          });
        }
        startTransition(() => {
          router.refresh();
        });
        return;
      }

      const response = await fetch(`/api/providers/${provider.id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error || "提交配置失败");
      }

      toast.success(
        `${provider.label} 配置流程已创建`,
      );
      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "操作失败";
      if (action === "refresh") {
        setRefreshSteps(buildProviderSteps(3, message));
        setRefreshSummaryText(message);
        appendRunLog({
          message: `${provider.label} 刷新失败：${message}`,
          provider: provider.label,
          tone: "error",
        });
      }
      toast.error(message);
    } finally {
      setPendingProviderId(null);
    }
  }

  function openCreateConfig(provider: MailProviderGroup) {
    const mode = provider.id === "outlook" ? "oauth" : provider.mode;
    setConfigMode("create");
    setConfigProvider(provider);
    setConfigMailbox(null);
    setConfigState({
      providerId: provider.id,
      mode,
      account: "",
      authState: "disconnected",
      syncHealth: "healthy",
      lastSyncedAt: "未同步",
      tenantId: "common",
      imapHost: mode === "imap" ? getDefaultImapHost(provider.id) : undefined,
      imapPort: mode === "imap" ? 993 : undefined,
      hasSecret: false,
      hasRefreshToken: false,
      syncFetchLimit: undefined,
    });
    setConfigLoading(false);
    setDeleteConfirmOpen(false);
    setTokensVisible(false);
    setTokensLoading(false);
    setProviderTokens(null);
    setOutlookDialogTab("oauth");
    setOutlookImportSaving(false);
    setOutlookImportValue("");
  }

  function openEditConfig(provider: MailProviderGroup, mailbox: MailMailbox) {
    setConfigMode("edit");
    setConfigProvider(provider);
    setConfigMailbox(mailbox);
    setConfigState(null);
    setDeleteConfirmOpen(false);
    setTokensVisible(false);
    setTokensLoading(false);
    setProviderTokens(null);
    setOutlookDialogTab("oauth");
    setOutlookImportSaving(false);
    setOutlookImportValue("");
  }

  async function toggleTokens() {
    if (!configProvider || !configState || configState.mode !== "oauth") return;

    if (tokensVisible) {
      setTokensVisible(false);
      setProviderTokens(null);
      return;
    }

    setTokensVisible(true);
    setTokensLoading(true);

    try {
      const params = new URLSearchParams({ tokens: "1" });
      if (configState.mailboxId) {
        params.set("mailboxId", configState.mailboxId);
      }
      const response = await fetch(`/api/providers/${configProvider.id}?${params.toString()}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("读取 token 失败");
      }
      const data = (await response.json()) as { tokens: ProviderTokenState };
      setProviderTokens(data.tokens);
    } catch (error) {
      setTokensVisible(false);
      setProviderTokens(null);
      toast.error(error instanceof Error ? error.message : "读取 token 失败");
    } finally {
      setTokensLoading(false);
    }
  }

  async function saveConfig() {
    if (!configProvider || !configState) return;
    setConfigSaving(true);

    try {
      const response = await fetch(`/api/providers/${configProvider.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(configState),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "保存失败");
      }

      const nextState = (await response.json()) as ProviderConfigState;
      setConfigState(nextState);
      toast.success(`${configProvider.label} 配置已保存`);
      startTransition(() => {
        router.refresh();
      });
      return nextState;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
      return null;
    } finally {
      setConfigSaving(false);
    }
  }

  async function startOAuth() {
    if (!configProvider || !configState) return;
    const shouldOpenChrome = configProvider.id === "gmail";
    const oauthWindow = shouldOpenChrome ? null : window.open("about:blank", "_blank");
    if (oauthWindow) {
      oauthWindow.opener = null;
    }

    const saved = await saveConfig();
    if (!saved) {
      oauthWindow?.close();
      return;
    }

    setOauthRedirecting(true);
    try {
      const query = new URLSearchParams();
      if (saved.mailboxId) {
        query.set("mailboxId", saved.mailboxId);
      }
      if (shouldOpenChrome && selectedChromeProfile) {
        query.set("chromeProfile", selectedChromeProfile);
      }
      const queryString = query.toString() ? `?${query.toString()}` : "";
      const response = await fetch(`/api/providers/${configProvider.id}${queryString}`, {
        method: "PATCH",
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "生成授权地址失败");
      }

      const payload = (await response.json()) as OAuthStartResponse;
      if (shouldOpenChrome && payload.openedInChrome) {
        toast.success("已在 Chrome 中打开 Gmail 授权页");
      } else if (oauthWindow) {
        oauthWindow.location.href = payload.authorizeUrl;
      } else {
        const fallbackWindow = window.open(payload.authorizeUrl, "_blank", "noopener,noreferrer");
        if (!fallbackWindow && shouldOpenChrome) {
          throw new Error(payload.chromeError || "Chrome 打开失败，请允许浏览器弹窗后重试");
        }
      }
      closeConfig();
    } catch (error) {
      oauthWindow?.close();
      toast.error(error instanceof Error ? error.message : "生成授权地址失败");
      setOauthRedirecting(false);
    }
  }

  async function saveImapAndClose() {
    const saved = await saveConfig();
    if (saved) closeConfig();
  }

  async function submitOutlookImport() {
    const payload = outlookImportValue.trim();
    if (!payload) {
      toast.error("请先粘贴 Outlook 批量导入内容");
      return;
    }

    setOutlookImportSaving(true);
    try {
      const response = await fetch("/api/providers/outlook/import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ payload }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || "Outlook 批量导入失败");
      }

      const result = (await response.json()) as OutlookImportResponse;
      toast.success(`已导入 ${result.imported} 个，更新 ${result.updated} 个 Outlook 账号`);
      closeConfig();
      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Outlook 批量导入失败");
    } finally {
      setOutlookImportSaving(false);
    }
  }

  async function deleteCurrentConfig() {
    if (!configProvider || !configState?.mailboxId || configMode !== "edit") return;
    setConfigDeleting(true);

    try {
      const mailboxId = configState.mailboxId;
      const response = await fetch(
        `/api/providers/${configProvider.id}?mailboxId=${encodeURIComponent(mailboxId)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "删除失败");
      }

      toast.success("邮箱配置已删除");
      closeConfig();
      startTransition(() => {
        const next = new URLSearchParams(params.toString());
        if (next.get("mailbox") === mailboxId) {
          next.delete("mailbox");
          next.set("source", "all");
        }
        const query = next.toString();
        router.push(query ? `/?${query}` : "/");
        router.refresh();
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除失败");
    } finally {
      setConfigDeleting(false);
    }
  }

  async function confirmDeleteMailboxFromList() {
    if (!deleteMailboxTarget) return;
    const { provider, mailbox, mode = "delete" } = deleteMailboxTarget;
    setDeleteMailboxPending(true);
    try {
      const response = mode === "clear-all"
        ? await fetch("/api/settings", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ action: "clearAllMessages" }),
          })
        : mode === "clear"
          ? await fetch(`/api/providers/${provider.id}`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ action: "clear", mailboxId: mailbox.id }),
            })
          : await fetch(
              `/api/providers/${provider.id}?mailboxId=${encodeURIComponent(mailbox.id)}`,
              { method: "DELETE" },
            );

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || (mode === "delete" ? "删除失败" : "清空失败"));
      }

      toast.success(
        mode === "clear-all"
          ? "全部邮箱邮件已清空"
          : mode === "clear"
            ? "邮箱邮件已清空"
            : "邮箱配置已删除",
      );
      setDeleteMailboxTarget(null);
      startTransition(() => {
        const next = new URLSearchParams(params.toString());
        if (mode === "delete" && next.get("mailbox") === mailbox.id) {
          next.delete("mailbox");
          next.set("source", "all");
        }
        const query = next.toString();
        router.push(query ? `/?${query}` : "/");
        router.refresh();
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : (mode === "delete" ? "删除失败" : "清空失败"));
    } finally {
      setDeleteMailboxPending(false);
    }
  }

  async function loadSettings() {
    setSettingsLoading(true);
    try {
      const response = await fetch("/api/settings", { cache: "no-store" });
      if (!response.ok) throw new Error("读取设置失败");
      const data = (await response.json()) as AppSettingsResponse;
      setRefreshInterval(data.refreshInterval);
      setNotificationsEnabled(Boolean(data.notificationsEnabled));
      setSingleSyncFetchLimit(data.singleSyncFetchLimit);
      setBulkSyncFetchLimit(data.bulkSyncFetchLimit);
      setAutoSyncFetchLimit(data.autoSyncFetchLimit);
      setDraftSingleSyncFetchLimit(String(data.singleSyncFetchLimit));
      setDraftBulkSyncFetchLimit(String(data.bulkSyncFetchLimit));
      setDraftAutoSyncFetchLimit(String(data.autoSyncFetchLimit));
      setAutoRefreshRunning(Boolean(data.autoRefresh?.running));
      setAutoRefreshNextRunAt(
        data.autoRefresh?.nextRunAt ??
          (data.refreshInterval > 0 ? new Date(Date.now() + data.refreshInterval * 1000).toISOString() : null),
      );
      setCountdownNow(Date.now());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取设置失败");
    } finally {
      setSettingsLoading(false);
    }
  }

  async function updateRefreshInterval(value: number) {
    const previous = refreshInterval;
    setRefreshInterval(value);
    setIsSelectOpen(false);
    setSettingsLoading(true);

    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ refreshInterval: value }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || "保存设置失败");
      }
      const data = (await response.json()) as AppSettingsResponse;
      setRefreshInterval(data.refreshInterval);
      setAutoRefreshRunning(Boolean(data.autoRefresh?.running));
      setAutoRefreshNextRunAt(
        data.autoRefresh?.nextRunAt ??
          (data.refreshInterval > 0 ? new Date(Date.now() + data.refreshInterval * 1000).toISOString() : null),
      );
      setCountdownNow(Date.now());
      toast.success(value > 0 ? "后端自动刷新已开启" : "后端自动刷新已关闭");
    } catch (error) {
      setRefreshInterval(previous);
      toast.error(error instanceof Error ? error.message : "保存设置失败");
    } finally {
      setSettingsLoading(false);
    }
  }

  async function updateNotificationsEnabled(value: boolean) {
    const previous = notificationsEnabled;
    setNotificationSaving(true);
    setNotificationsEnabled(value);

    try {
      if (value) {
        if (!("Notification" in window)) {
          setNotificationPermission("unsupported");
          throw new Error("当前浏览器不支持通知");
        }

        const permission = Notification.permission === "default"
          ? await Notification.requestPermission()
          : Notification.permission;
        setNotificationPermission(permission);

        if (permission !== "granted") {
          throw new Error("通知权限未开启");
        }
      }

      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ notificationsEnabled: value }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || "保存通知设置失败");
      }
      const data = (await response.json()) as AppSettingsResponse;
      setNotificationsEnabled(Boolean(data.notificationsEnabled));
      toast.success(data.notificationsEnabled ? "新邮件通知已开启" : "新邮件通知已关闭");
    } catch (error) {
      setNotificationsEnabled(previous);
      toast.error(error instanceof Error ? error.message : "保存通知设置失败");
    } finally {
      setNotificationSaving(false);
    }
  }

  async function updateSyncFetchLimit(kind: "single" | "bulk", value: number) {
    const trimmed = String(value).trim();
    const nextValue = Number(trimmed);

    if (!Number.isInteger(nextValue) || nextValue < 1 || nextValue > 3) {
      toast.error("邮件获取数量必须在 1 到 3 之间");
      return;
    }

    const isSingle = kind === "single";
    const previous = isSingle ? singleSyncFetchLimit : bulkSyncFetchLimit;

    if (previous === nextValue) {
      return;
    }

    if (isSingle) {
      setSingleSyncFetchLimit(nextValue);
    } else {
      setBulkSyncFetchLimit(nextValue);
    }

    setSettingsLoading(true);

    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          isSingle
            ? { singleSyncFetchLimit: nextValue }
            : { bulkSyncFetchLimit: nextValue },
        ),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || "保存设置失败");
      }

      const data = (await response.json()) as AppSettingsResponse;
      setSingleSyncFetchLimit(data.singleSyncFetchLimit);
      setBulkSyncFetchLimit(data.bulkSyncFetchLimit);
      toast.success(isSingle ? "单邮箱邮件获取数量已更新" : "批量邮箱邮件获取数量已更新");
    } catch (error) {
      if (isSingle) {
        setSingleSyncFetchLimit(previous);
      } else {
        setBulkSyncFetchLimit(previous);
      }
      toast.error(error instanceof Error ? error.message : "保存设置失败");
    } finally {
      setSettingsLoading(false);
    }
  }

  async function saveSyncFetchLimits() {
    const nextSingle = Number(draftSingleSyncFetchLimit.trim());
    const nextBulk = Number(draftBulkSyncFetchLimit.trim());
    const nextAuto = Number(draftAutoSyncFetchLimit.trim());

    if (!Number.isInteger(nextSingle) || nextSingle < 1 || nextSingle > 3) {
      toast.error("单个邮箱邮件获取数量必须在 1 到 3 之间");
      return;
    }

    if (!Number.isInteger(nextBulk) || nextBulk < 1 || nextBulk > 3) {
      toast.error("批量邮箱邮件获取数量必须在 1 到 3 之间");
      return;
    }

    if (!Number.isInteger(nextAuto) || nextAuto < 1 || nextAuto > 3) {
      toast.error("自动拉取邮件数量必须在 1 到 3 之间");
      return;
    }

    if (
      nextSingle === singleSyncFetchLimit &&
      nextBulk === bulkSyncFetchLimit &&
      nextAuto === autoSyncFetchLimit
    ) {
      toast.success("邮件获取数量未变更");
      return;
    }

    const previousSingle = singleSyncFetchLimit;
    const previousBulk = bulkSyncFetchLimit;
    const previousAuto = autoSyncFetchLimit;
    setSingleSyncFetchLimit(nextSingle);
    setBulkSyncFetchLimit(nextBulk);
    setAutoSyncFetchLimit(nextAuto);
    setSyncFetchLimitSaving(true);
    setSettingsLoading(true);

    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          singleSyncFetchLimit: nextSingle,
          bulkSyncFetchLimit: nextBulk,
          autoSyncFetchLimit: nextAuto,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || "保存设置失败");
      }

      const data = (await response.json()) as AppSettingsResponse;
      setSingleSyncFetchLimit(data.singleSyncFetchLimit);
      setBulkSyncFetchLimit(data.bulkSyncFetchLimit);
      setAutoSyncFetchLimit(data.autoSyncFetchLimit);
      setDraftSingleSyncFetchLimit(String(data.singleSyncFetchLimit));
      setDraftBulkSyncFetchLimit(String(data.bulkSyncFetchLimit));
      setDraftAutoSyncFetchLimit(String(data.autoSyncFetchLimit));
      toast.success("邮件获取数量已保存");
    } catch (error) {
      setSingleSyncFetchLimit(previousSingle);
      setBulkSyncFetchLimit(previousBulk);
      setAutoSyncFetchLimit(previousAuto);
      setDraftSingleSyncFetchLimit(String(previousSingle));
      setDraftBulkSyncFetchLimit(String(previousBulk));
      setDraftAutoSyncFetchLimit(String(previousAuto));
      toast.error(error instanceof Error ? error.message : "保存设置失败");
    } finally {
      setSyncFetchLimitSaving(false);
      setSettingsLoading(false);
    }
  }

  async function exportBackup() {
    setBackupExporting(true);
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "exportBackup" }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || "导出备份失败");
      }

      const payload = (await response.json()) as BackupExportResponse;
      const content = JSON.stringify(payload, null, 2);
      const blob = new Blob([content], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const timestamp = payload.exportedAt.replaceAll(":", "-");
      anchor.href = url;
      anchor.download = `mymail-backup-${timestamp}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success("备份文件已导出");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "导出备份失败");
    } finally {
      setBackupExporting(false);
    }
  }

  async function handleBackupFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      setBackupFileName("");
      setBackupPayload(null);
      return;
    }

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as BackupExportResponse;
      setBackupFileName(file.name);
      setBackupPayload(parsed);
      toast.success("备份文件已载入");
    } catch {
      setBackupFileName("");
      setBackupPayload(null);
      event.target.value = "";
      toast.error("备份文件不是有效的 JSON");
    }
  }

  async function importBackup(mode: "replace" | "merge") {
    if (!backupPayload) {
      toast.error("请先选择备份文件");
      return;
    }

    if (
      mode === "replace" &&
      !window.confirm("会清空当前本地设置、邮箱配置和邮件缓存，再恢复备份内容")
    ) {
      return;
    }

    setBackupImportingMode(mode);
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "importBackup",
          mode,
          payload: backupPayload,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || "导入备份失败");
      }

      const result = (await response.json()) as BackupImportResponse;
      await loadSettings();
      startTransition(() => {
        router.refresh();
      });
      toast.success(
        `${mode === "replace" ? "覆盖" : "合并"}导入完成：设置 ${result.appSettingsCount} 条，邮箱 ${result.providersCount} 条，邮件 ${result.messagesCount} 条`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "导入备份失败");
    } finally {
      setBackupImportingMode(null);
    }
  }

  const nextRefreshSeconds = refreshInterval > 0 && autoRefreshNextRunAt
    ? Math.max(0, Math.ceil((Date.parse(autoRefreshNextRunAt) - countdownNow) / 1000))
    : null;
  const nextRefreshLabel = nextRefreshSeconds !== null ? formatCountdown(nextRefreshSeconds) : null;

  return (
    <aside
      className={`relative flex min-h-0 flex-col overflow-hidden border-slate-200/70 bg-white/95 p-4 backdrop-blur-md md:border-r md:bg-transparent md:backdrop-blur-0 max-md:fixed max-md:inset-x-3 max-md:bottom-3 max-md:z-40 max-md:rounded-[15px] max-md:border max-md:shadow-[0_18px_60px_rgba(15,23,42,0.16)] ${
        mobilePanelOpen
          ? "max-md:max-h-[70dvh]"
          : "max-md:h-[92px] max-md:min-h-[92px]"
      }`}
    >
      <div className="px-2 pb-3 md:pb-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold tracking-tight">邮箱管理</h2>
            <p className="mt-2 text-xs font-medium text-slate-500">
              {refreshInterval > 0 && nextRefreshLabel
                ? `${autoRefreshRunning ? "自动刷新进行中" : "下次刷新倒计时"} ${nextRefreshLabel}`
                : "自动刷新已关闭"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <p className="text-xs text-slate-500">
              {providers.reduce((sum, provider) => sum + provider.mailboxes.length, 0)} 个账号
            </p>
            <button
              type="button"
              onClick={() => setMobilePanelOpen((open) => !open)}
              className="grid h-8 w-8 place-items-center rounded-[12px] border border-slate-200 text-slate-500 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 md:hidden"
              aria-label={mobilePanelOpen ? "收起邮箱管理" : "展开邮箱管理"}
              aria-expanded={mobilePanelOpen}
            >
              <i
                className={`fa-solid fa-chevron-down text-xs transition-transform ${mobilePanelOpen ? "rotate-180" : ""}`}
                aria-hidden="true"
              />
            </button>
          </div>
        </div>
      </div>

      <div
        className={`scrollbar-thin scrollbar-gutterless min-h-0 flex-1 space-y-2 overflow-y-auto ${
          mobilePanelOpen ? "block" : "hidden md:block"
        }`}
      >

        <div
          className={`flex items-center gap-2 rounded-[15px] border px-3 py-2 transition ${
            isMailboxSelectionActive && activeSource === "all"
              ? "border-slate-300 bg-slate-100 shadow-sm"
              : "border-slate-200/70 bg-white/70"
          }`}
        >
          <button
            type="button"
            onClick={() => setSource("all")}
            className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          >
            <i
              className={`fa-solid fa-inbox w-3.5 text-center text-[13px] ${
                isMailboxSelectionActive && activeSource === "all" ? "text-slate-950" : "text-slate-900"
              }`}
              aria-hidden="true"
            />
            <span
              className={`min-w-0 truncate text-sm font-semibold ${
                isMailboxSelectionActive && activeSource === "all" ? "text-slate-950" : "text-slate-900"
              }`}
            >
              全部邮箱
            </span>
            {providers.reduce((sum, provider) => sum + provider.unreadCount, 0) > 0 && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">
                {providers.reduce((sum, provider) => sum + provider.unreadCount, 0)}
              </span>
            )}
          </button>
        </div>

        {providers.map((provider) => (
          <details
            key={provider.id}
            open={openProviderIds.includes(provider.id)}
            onToggle={(event) => {
              const isOpen = event.currentTarget.open;
              setOpenProviderIds((current) => {
                if (isOpen) {
                  return current.includes(provider.id) ? current : [...current, provider.id];
                }
                return current.filter((id) => id !== provider.id);
              });
            }}
            className="rounded-[15px] border border-slate-200/70 bg-white/70"
          >
            <summary
              onContextMenu={(e) => {
                e.stopPropagation();
                showMenu(e, [
                  {
                    label: `刷新 ${provider.label}`,
                    icon: "fa-solid fa-rotate",
                    onClick: () => handleProviderAction(provider, "refresh"),
                  },
                  {
                    label: "添加邮箱账号",
                    icon: "fa-solid fa-plus",
                    onClick: () => openCreateConfig(provider),
                  },
                ]);
              }}
              className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 [&::-webkit-details-marker]:hidden"
            >
              <div className="flex min-w-0 flex-1 items-center gap-2 text-left">
                <i
                  className={`${getProviderIcon(provider.id)} text-[13px] w-3.5 text-center`}
                  style={{ color: provider.accent }}
                  aria-hidden="true"
                />
                <span className="min-w-0 truncate text-sm font-semibold text-slate-900">
                  {provider.label}
                </span>
                {provider.unreadCount > 0 && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500 shrink-0">
                    {provider.unreadCount}
                  </span>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleProviderAction(provider, "refresh");
                  }}
                  disabled={pendingProviderId === provider.id}
                  aria-label={`${provider.label} 刷新`}
                  className="grid h-8 w-8 place-items-center rounded-[15px] bg-white/0 text-slate-600 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <i className="fa-solid fa-rotate text-sm" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    openCreateConfig(provider);
                  }}
                  aria-label={`${provider.label} 添加邮箱`}
                  className="grid h-8 w-8 place-items-center rounded-[15px] bg-white/0 text-slate-600 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                >
                  <i className="fa-solid fa-plus text-sm" aria-hidden="true" />
                </button>
                <i className="fa-solid fa-chevron-down shrink-0 text-xs text-slate-400 transition-transform duration-200 [details[open]_&]:rotate-180" aria-hidden="true" />
              </div>
            </summary>

            <div className="border-t border-slate-200/70 px-3 py-3 text-xs text-slate-500">
              {provider.mailboxes.length ? (
                <div className="space-y-2">
                  {provider.mailboxes.map((mailbox) => (
                    <div
                      key={mailbox.id}
                      onContextMenu={(e) => {
                        e.stopPropagation();
                        showMenu(e, [
                          {
                            label: "切换至该邮箱",
                            icon: "fa-solid fa-envelope",
                            onClick: () => setMailboxSource(provider.id, mailbox.id),
                          },
                          {
                            label: "配置此邮箱",
                            icon: "fa-solid fa-gear",
                            onClick: () => openEditConfig(provider, mailbox),
                          },
                          {
                            label: "复制账号地址",
                            icon: "fa-solid fa-copy",
                            onClick: () => {
                              navigator.clipboard.writeText(mailbox.account);
                              toast.success("已复制邮箱账号");
                            },
                          },
                          {
                            label: "清空邮箱邮件",
                            icon: "fa-solid fa-broom",
                            onClick: () => openClearMailboxDialog(provider, mailbox),
                          },
                          {
                            label: "删除邮箱",
                            icon: "fa-solid fa-trash",
                            danger: true,
                            onClick: () => openDeleteMailboxDialog(provider, mailbox),
                          },
                        ]);
                      }}
                      className={`flex items-center gap-2 rounded-[12px] px-2 py-1 ${
                        isMailboxSelectionActive && activeSource === provider.id && activeMailbox === mailbox.id
                          ? "bg-slate-100"
                          : ""
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setMailboxSource(provider.id, mailbox.id)}
                        className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-[12px] px-3 py-2 text-left transition hover:bg-slate-50"
                      >
                        <span className="min-w-0 truncate text-sm font-medium text-slate-700">
                          {mailbox.account}
                        </span>
                        {mailbox.unreadCount > 0 && (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500 shrink-0">
                            {mailbox.unreadCount}
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditConfig(provider, mailbox)}
                        className="grid h-8 w-8 place-items-center rounded-[12px] text-slate-500 transition hover:bg-slate-100"
                        aria-label={`${mailbox.account} 配置`}
                      >
                        <i className="fa-solid fa-pen text-sm" aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex min-h-20 items-center justify-center text-sm font-medium text-slate-400">
                  暂未添加邮箱
                </div>
              )}
            </div>
          </details>
        ))}
      </div>

      <div className={`mt-4 border-t border-slate-200/70 pt-4 ${mobilePanelOpen ? "block" : "hidden md:block"}`}>
        <button
          type="button"
          onClick={openRunLogs}
          className={`mb-3 flex w-full items-center gap-2 rounded-[15px] border px-3 py-2.5 text-left text-sm font-semibold transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 ${
            isLogsView
              ? "border-slate-300 bg-slate-100 text-slate-950 shadow-sm"
              : "border-slate-200/70 bg-white/70 text-slate-700"
          }`}
        >
          <i className="fa-solid fa-terminal text-slate-500" aria-hidden="true" />
          <span>运行日志</span>
          <i className="fa-solid fa-table-columns ml-auto text-[11px] text-slate-400" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={() => {
            setIsSettingsOpen(true);
            void loadSettings();
          }}
          className="flex w-full items-center gap-2 rounded-[15px] border border-slate-200/70 bg-white/70 px-3 py-2.5 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
        >
          <i className="fa-solid fa-gear text-slate-500" aria-hidden="true" />
          <span>应用设置</span>
        </button>
      </div>

      {portalReady && refreshSteps
        ? createPortal(
            <div className="fixed bottom-4 right-4 z-40 flex w-[min(420px,calc(100vw-2rem))] flex-col gap-2 pointer-events-none">
              <div className="pointer-events-auto overflow-hidden rounded-[16px] border border-slate-200/80 bg-white/92 shadow-[0_18px_60px_rgba(15,23,42,0.16)] backdrop-blur-md animate-in slide-in-from-bottom-3 fade-in duration-200">
                <div className="flex items-center justify-between border-b border-slate-200/70 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-slate-900">
                      {refreshSummaryText || "正在刷新邮件"}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-slate-400">
                      {refreshProviderLabel ? `${refreshProviderLabel} 全部邮箱` : "邮箱类型批量刷新"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setRefreshSteps(null);
                      setRefreshResults(null);
                      setRefreshSummaryText(null);
                      setRefreshProviderLabel(null);
                      setRefreshAccountLabel(null);
                      setRefreshAccountSteps(null);
                      setRefreshAutoCloseSeconds(null);
                    }}
                    className="grid h-7 w-7 place-items-center rounded-[10px] text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                    aria-label="关闭刷新详情"
                  >
                    <i className="fa-solid fa-xmark text-[11px]" aria-hidden="true" />
                  </button>
                </div>

                {refreshAccountSteps ? (
                  <div className="grid gap-1 px-3 py-2">
                    <div className="mb-1 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-slate-900">
                          {refreshAccountLabel || "正在刷新账号"}
                        </p>
                        <p className="mt-0.5 truncate text-[11px] text-slate-400">
                          当前账号刷新过程
                        </p>
                      </div>
                    </div>
                    {refreshAccountSteps.map((step) => (
                      <div key={step.id} className="flex gap-2 py-1">
                        <ProgressDot status={step.status} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-3">
                            <p className="truncate text-xs font-semibold text-slate-800">{step.label}</p>
                            <p className="text-[10px] font-semibold text-slate-400">{stepStatusText(step.status)}</p>
                          </div>
                          <p className={`mt-0.5 truncate text-[11px] ${step.status === "error" ? "text-rose-500" : "text-slate-400"}`}>
                            {step.detail}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="px-3 py-4 text-xs font-medium text-slate-400">
                    准备刷新账号...
                  </div>
                )}

                {refreshResults?.length ? (
                  <div className="max-h-36 overflow-y-auto border-t border-slate-200/70 px-3 py-2">
                    {refreshResults.map((result) => (
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
              </div>

              {refreshAutoCloseSeconds ? (
                <div className="pointer-events-auto rounded-[12px] border border-slate-200/80 bg-white/92 px-3 py-2 text-right text-[11px] font-medium text-slate-400 shadow-[0_12px_40px_rgba(15,23,42,0.10)] backdrop-blur-md">
                    {refreshAutoCloseSeconds} 秒后自动关闭
                </div>
              ) : null}
            </div>,
            document.body,
          )
    : null}

      {portalReady ? (
        <DialogTransition
          open={Boolean(deleteMailboxTarget)}
          onClose={closeDeleteMailboxDialog}
          titleId="delete-mailbox-title"
        >
          {deleteMailboxTarget ? (
            <div className="w-full max-w-sm rounded-[15px] border border-slate-200 bg-white p-4 shadow-xl">
              <div className="flex items-start gap-3">
                <div
                  className={`grid h-10 w-10 shrink-0 place-items-center rounded-[14px] ${
                    deleteMailboxTarget.mode === "clear" || deleteMailboxTarget.mode === "clear-all"
                      ? "bg-amber-50 text-amber-700"
                      : "bg-rose-50 text-rose-600"
                  }`}
                >
                  <i
                    className={`fa-solid ${deleteMailboxTarget.mode === "delete" ? "fa-trash" : "fa-broom"} text-sm`}
                    aria-hidden="true"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 id="delete-mailbox-title" className="text-base font-semibold text-slate-900">
                    {deleteMailboxTarget.mode === "clear-all"
                      ? "清空全部邮件"
                      : deleteMailboxTarget.mode === "clear"
                        ? "清空邮箱"
                        : "删除邮箱"}
                  </h3>
                  <p className="mt-1 text-sm leading-6 text-slate-500">
                    {deleteMailboxTarget.mode === "clear-all"
                      ? "将清空所有邮箱账号的本地缓存邮件，但保留邮箱配置与授权信息。"
                      : deleteMailboxTarget.mode === "clear"
                        ? "将清空这个邮箱的本地缓存邮件，但保留账号配置。"
                        : "将移除账号配置和本地缓存邮件，此操作不可撤销。"}
                  </p>
                  <div className="mt-3 rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                    {deleteMailboxTarget.mailbox.account}
                  </div>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={closeDeleteMailboxDialog}
                  disabled={deleteMailboxPending}
                  className="rounded-[15px] border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => void confirmDeleteMailboxFromList()}
                  disabled={deleteMailboxPending}
                  className={`rounded-[15px] px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 ${
                    deleteMailboxTarget.mode === "delete" ? "bg-rose-600" : "bg-amber-600"
                  }`}
                >
                  {deleteMailboxPending
                    ? deleteMailboxTarget.mode === "delete" ? "删除中..." : "清空中..."
                    : deleteMailboxTarget.mode === "delete" ? "确认删除" : "确认清空"}
                </button>
              </div>
            </div>
          ) : null}
        </DialogTransition>
      ) : null}

      {portalReady ? (
        <DialogTransition open={Boolean(configProvider)} onClose={closeConfig} titleId="mailbox-config-title">
          {configProvider ? (
          <div className={`w-full rounded-[15px] border border-slate-200 bg-white p-4 shadow-xl ${configProvider.id === "outlook" && configMode === "create" ? "max-w-2xl" : "max-w-md"}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id="mailbox-config-title" className="text-base font-semibold text-slate-900">
                  {configMode === "create" ? `添加 ${configProvider.label} 邮箱` : `${configProvider.label} 配置`}
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  {configProvider.id === "outlook" && configMode === "create"
                    ? (outlookDialogTab === "oauth" ? "Microsoft 官方授权" : "格式：邮箱----密码----client_id----refresh_token")
                    : configProvider.authHint}
                </p>
              </div>
              <button
                type="button"
                onClick={closeConfig}
                className="grid h-8 w-8 place-items-center rounded-[15px] border border-slate-200 text-slate-500"
                aria-label="关闭配置"
              >
                <i className="fa-solid fa-xmark text-sm" aria-hidden="true" />
              </button>
            </div>

            {configLoading || !configState ? (
              <div className="mt-4 rounded-[15px] bg-slate-50 px-3 py-8 text-center text-sm text-slate-500">
                读取配置中...
              </div>
            ) : (
              <>
                {configProvider.id === "outlook" && configMode === "create" ? (
                  <div className="mt-4 inline-flex rounded-[15px] border border-slate-200 bg-slate-50 p-1">
                    <button
                      type="button"
                      onClick={() => setOutlookDialogTab("oauth")}
                      className={`rounded-[12px] px-4 py-2 text-sm font-semibold transition ${
                        outlookDialogTab === "oauth"
                          ? "bg-white text-slate-950 shadow-sm"
                          : "text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      官方授权
                    </button>
                    <button
                      type="button"
                      onClick={() => setOutlookDialogTab("import")}
                      className={`rounded-[12px] px-4 py-2 text-sm font-semibold transition ${
                        outlookDialogTab === "import"
                          ? "bg-white text-slate-950 shadow-sm"
                          : "text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      批量导入
                    </button>
                  </div>
                ) : null}

                {configProvider.id === "outlook" && configMode === "create" && outlookDialogTab === "import" ? (
                  <div className="mt-4 space-y-3">
                    <div className="rounded-[15px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                      用于 Outlook 导入账号。当前导入链路会按 IMAP OAuth2 处理，不走 Graph。
                    </div>
                    <textarea
                      value={outlookImportValue}
                      onChange={(event) => setOutlookImportValue(event.target.value)}
                      className="h-72 w-full rounded-[15px] border border-slate-200 bg-white px-3 py-3 font-mono text-xs leading-6 text-slate-700 outline-none transition focus:border-slate-400"
                      placeholder={"user@outlook.com----password----client-id----refresh-token"}
                    />
                  </div>
                ) : (
                <div className="mt-4 space-y-3">
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">收件邮箱</span>
                    <input
                      name="email"
                      autoComplete="email"
                      value={configState.account}
                      onChange={(event) => {
                        const nextAccount = event.target.value;
                        setConfigState((current) =>
                          current
                            ? {
                                ...current,
                                account: nextAccount,
                                imapHost:
                                  configProvider.id !== "outlook" &&
                                  current.mode === "imap" &&
                                  isProviderDefaultImapHost(current.imapHost)
                                    ? getDefaultImapHost(configProvider.id)
                                    : current.imapHost,
                                imapPort: current.mode === "imap" ? current.imapPort || 993 : current.imapPort,
                              }
                            : current,
                        );
                        if (configProvider.id === "gmail" && chromeProfiles.length > 0) {
                          setSelectedChromeProfile(selectBestChromeProfile(chromeProfiles, nextAccount));
                        }
                      }}
                      className="w-full rounded-[15px] border border-slate-200 bg-white px-3 py-2 text-sm outline-none ring-0 transition focus:border-slate-400"
                      placeholder="name@example.com"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">当前邮箱拉取数量</span>
                    <span className="mb-2 block text-xs text-slate-400">留空则使用全局“单个邮箱邮件获取数量”设置。</span>
                    <input
                      type="number"
                      min={1}
                      max={3}
                      value={configState.syncFetchLimit ?? ""}
                      onChange={(event) => {
                        const rawValue = event.target.value.trim();
                        setConfigState((current) =>
                          current
                            ? {
                                ...current,
                                syncFetchLimit: rawValue ? Number(rawValue) : undefined,
                              }
                            : current,
                        );
                      }}
                      className="w-full rounded-[15px] border border-slate-200 bg-white px-3 py-2 text-sm outline-none ring-0 transition focus:border-slate-400"
                      placeholder={`默认 ${singleSyncFetchLimit}`}
                    />
                  </label>

                  {configState.mode === "oauth" ? (
                    <>
                      {configProvider.id === "outlook" ? (
                        <label className="block">
                          <span className="mb-2 block text-sm font-semibold text-slate-700">Tenant ID</span>
                          <input
                            name="mymail-tenant-id"
                            autoComplete="off"
                            value={configState.tenantId ?? "common"}
                            onChange={(event) =>
                              setConfigState((current) =>
                                current ? { ...current, tenantId: event.target.value } : current,
                              )
                            }
                            className="w-full rounded-[15px] border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-400"
                            placeholder="common"
                          />
                        </label>
                      ) : null}

                      {configProvider.id === "gmail" ? (
                        <label className="block">
                          <span className="mb-2 block text-sm font-semibold text-slate-700">用于授权的 Chrome 账号</span>
                          <select
                            value={selectedChromeProfile}
                            onChange={(event) => setSelectedChromeProfile(event.target.value)}
                            disabled={chromeProfilesLoading || chromeProfiles.length === 0}
                            className="w-full rounded-[15px] border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {chromeProfiles.length === 0 ? (
                              <option value="">
                                {chromeProfilesLoading ? "正在读取 Chrome 账号..." : "使用 Chrome 默认账号"}
                              </option>
                            ) : (
                              chromeProfiles.map((profile) => (
                                <option key={profile.directory} value={profile.directory}>
                                  {profile.label}
                                  {profile.isLastUsed ? "（最近使用）" : ""}
                                </option>
                              ))
                            )}
                          </select>
                          <p className="mt-2 text-xs leading-5 text-slate-500">
                            会打开该账号所在的 Chrome 窗口完成 Gmail 授权；未读取到账号时使用 Chrome 当前默认账号。
                          </p>
                        </label>
                      ) : null}

                      {configMode === "edit" && configState.mailboxId && (
                        <div className="rounded-[15px] border border-slate-200 bg-slate-50/70 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-700">OAuth Token</p>
                              <p className="mt-1 text-xs text-slate-500">
                                {configState.hasRefreshToken ? "已获取 refresh token" : "尚未获取 refresh token"}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => void toggleTokens()}
                              disabled={tokensLoading}
                              className="shrink-0 rounded-[12px] border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {tokensLoading ? "读取中..." : tokensVisible ? "隐藏 token" : "显示 token"}
                            </button>
                          </div>

                          {tokensVisible ? (
                            <div className="mt-3 space-y-3">
                              <label className="block">
                                <span className="mb-1 block text-xs font-semibold text-slate-500">Access Token</span>
                                <textarea
                                  readOnly
                                  value={providerTokens?.accessToken ?? "未获取 access token"}
                                  className="h-20 w-full resize-none rounded-[12px] border border-slate-200 bg-white px-3 py-2 font-mono text-[11px] leading-5 text-slate-700 outline-none"
                                />
                              </label>
                              <label className="block">
                                <span className="mb-1 block text-xs font-semibold text-slate-500">Refresh Token</span>
                                <textarea
                                  readOnly
                                  value={providerTokens?.refreshToken ?? "未获取 refresh token"}
                                  className="h-20 w-full resize-none rounded-[12px] border border-slate-200 bg-white px-3 py-2 font-mono text-[11px] leading-5 text-slate-700 outline-none"
                                />
                              </label>
                              {providerTokens?.expiryDate ? (
                                <p className="text-xs text-slate-500">
                                  Access Token 过期时间：{new Date(providerTokens.expiryDate).toLocaleString("zh-CN")}
                                </p>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      )}

                    </>
                  ) : (
                    <>
                      <label className="block">
                        <span className="mb-2 block text-sm font-semibold text-slate-700">IMAP Host</span>
                        <input
                          name="mymail-imap-host"
                          autoComplete="off"
                          value={configState.imapHost ?? ""}
                          onChange={(event) =>
                            setConfigState((current) =>
                              current ? { ...current, imapHost: event.target.value } : current,
                            )
                          }
                          className="w-full rounded-[15px] border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-400"
                          placeholder={configProvider.id === "outlook" ? "outlook.office365.com" : "imap.qq.com"}
                        />
                      </label>

                      <label className="block">
                        <span className="mb-2 block text-sm font-semibold text-slate-700">IMAP Port</span>
                        <input
                          name="mymail-imap-port"
                          autoComplete="off"
                          type="number"
                          value={configState.imapPort ?? 993}
                          onChange={(event) =>
                            setConfigState((current) =>
                              current
                                ? { ...current, imapPort: Number(event.target.value || 993) }
                                : current,
                            )
                          }
                          className="w-full rounded-[15px] border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-400"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-2 block text-sm font-semibold text-slate-700">授权码</span>
                        <input
                          name="mymail-authorization-code"
                          autoComplete="new-password"
                          type="password"
                          value={configState.authorizationCode ?? ""}
                          onChange={(event) =>
                            setConfigState((current) =>
                              current
                                ? {
                                    ...current,
                                    hasSecret: event.target.value.length > 0,
                                    authorizationCode: event.target.value,
                                  }
                                : current,
                            )
                          }
                          className="w-full rounded-[15px] border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-400"
                          placeholder={configState.hasSecret ? "已保存，如需更新请重新输入" : "邮箱客户端授权码"}
                        />
                      </label>
                    </>
                  )}
                </div>
                )}

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    {configMode === "edit" && configState.mailboxId ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openClearMailboxDialog(configProvider, {
                            id: configState.mailboxId!,
                            providerId: configProvider.id,
                            account: configState.account,
                            status: configState.authState as "connected" | "degraded" | "disconnected" | "reauth",
                            health: configState.syncHealth as "healthy" | "rate_limited" | "offline" | "auth_expired" | "error",
                            unreadCount: 0,
                            lastSyncedAt: configState.lastSyncedAt,
                            lastError: configState.lastError,
                            syncFetchLimit: configState.syncFetchLimit,
                          })}
                          disabled={configSaving || oauthRedirecting || configDeleting}
                          className="rounded-[15px] border border-amber-200 px-3 py-2 text-sm font-semibold text-amber-700 transition hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          清空邮箱
                        </button>
                        {deleteConfirmOpen ? (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setDeleteConfirmOpen(false)}
                            disabled={configDeleting}
                            className="rounded-[15px] border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            取消
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteCurrentConfig()}
                            disabled={configDeleting}
                            className="rounded-[15px] bg-rose-600 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {configDeleting ? "删除中..." : "确认删除"}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setDeleteConfirmOpen(true)}
                          disabled={configSaving || oauthRedirecting || configDeleting}
                          className="rounded-[15px] border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            删除配置
                          </button>
                        )}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={closeConfig}
                      className="rounded-[15px] border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600"
                    >
                      取消
                    </button>

                    {configProvider.id === "outlook" && configMode === "create" && outlookDialogTab === "import" ? (
                      <button
                        type="button"
                        onClick={() => void submitOutlookImport()}
                        disabled={outlookImportSaving}
                        className="rounded-[15px] bg-slate-950 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {outlookImportSaving ? "导入中..." : "确认导入"}
                      </button>
                    ) : configState.mode === "oauth" ? (
                      <button
                        type="button"
                        onClick={startOAuth}
                        disabled={configSaving || oauthRedirecting || configDeleting}
                        className="rounded-[15px] bg-slate-950 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {oauthRedirecting ? "跳转中..." : configSaving ? "保存中..." : "保存并授权"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={saveImapAndClose}
                        disabled={configSaving || configDeleting}
                        className="rounded-[15px] bg-slate-950 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {configSaving ? "保存中..." : "保存配置"}
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
          ) : null}
        </DialogTransition>
      ) : null}

      {portalReady ? (
        <DialogTransition
          open={isSettingsOpen}
          onClose={() => {
            setIsSettingsOpen(false);
            setIsSelectOpen(false);
          }}
          titleId="app-settings-title"
        >
              <div className="w-full max-w-4xl rounded-[15px] border border-slate-200 bg-white p-4 shadow-xl">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 id="app-settings-title" className="text-base font-semibold text-slate-900">应用设置</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setIsSettingsOpen(false);
                      setIsSelectOpen(false);
                    }}
                    className="grid h-8 w-8 place-items-center rounded-[15px] border border-slate-200 text-slate-500 transition hover:bg-slate-50"
                    aria-label="关闭设置"
                  >
                    <i className="fa-solid fa-xmark text-sm" aria-hidden="true" />
                  </button>
                </div>

                <div className="mt-4 space-y-4">
                  <div className="relative">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">自动刷新邮件间隔</span>
                    <button
                      type="button"
                      onClick={() => setIsSelectOpen(!isSelectOpen)}
                      className="flex w-full items-center justify-between rounded-[15px] border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:border-slate-400 focus:outline-none"
                    >
                      <span>
                        {refreshIntervalOptions.find((opt) => opt.value === refreshInterval)?.label || "关闭自动刷新"}
                      </span>
                      <i
                        className={`fa-solid fa-chevron-down text-slate-400 text-xs transition-transform duration-200 ${
                          isSelectOpen ? "rotate-180" : ""
                        }`}
                        aria-hidden="true"
                      />
                    </button>
                    {isSelectOpen && (
                      <div className="absolute left-0 right-0 z-50 mt-1.5 rounded-[15px] border border-slate-200 bg-white p-1.5 shadow-xl">
                        {refreshIntervalOptions.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            disabled={settingsLoading}
                            onClick={() => void updateRefreshInterval(option.value)}
                            className={`flex w-full items-center justify-between rounded-[12px] px-3 py-2.5 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${
                              refreshInterval === option.value
                                ? "bg-slate-950 text-white font-semibold"
                                : "text-slate-700 hover:bg-slate-50"
                            }`}
                          >
                            <span>{option.label}</span>
                            {refreshInterval === option.value && (
                              <i className="fa-solid fa-check text-xs" aria-hidden="true" />
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="border-t border-slate-200/70 pt-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="block text-base font-semibold text-slate-900">拉取数量</span>
                      <button
                        type="button"
                        onClick={() => void saveSyncFetchLimits()}
                        disabled={settingsLoading || syncFetchLimitSaving}
                        className="shrink-0 rounded-[15px] bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {syncFetchLimitSaving ? "保存中..." : "保存"}
                      </button>
                    </div>

                    <div className="mt-4 grid gap-4 md:grid-cols-3">
                      <label className="grid gap-2 rounded-[14px] border border-slate-200/80 bg-slate-50/60 p-3">
                        <span className="text-sm font-medium text-slate-700">手动拉取单个邮箱数量</span>
                        <input
                          type="number"
                          min={1}
                          max={3}
                          value={draftSingleSyncFetchLimit}
                          disabled={settingsLoading || syncFetchLimitSaving}
                          onChange={(event) => setDraftSingleSyncFetchLimit(event.target.value)}
                          className="h-11 rounded-[14px] border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
                        />
                      </label>

                      <label className="grid gap-2 rounded-[14px] border border-slate-200/80 bg-slate-50/60 p-3">
                        <span className="text-sm font-medium text-slate-700">手动拉取批量邮箱数量</span>
                        <input
                          type="number"
                          min={1}
                          max={3}
                          value={draftBulkSyncFetchLimit}
                          disabled={settingsLoading || syncFetchLimitSaving}
                          onChange={(event) => setDraftBulkSyncFetchLimit(event.target.value)}
                          className="h-11 rounded-[14px] border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
                        />
                      </label>

                      <label className="grid gap-2 rounded-[14px] border border-slate-200/80 bg-slate-50/60 p-3">
                        <span className="text-sm font-medium text-slate-700">自动拉取邮箱数量</span>
                        <input
                          type="number"
                          min={1}
                          max={3}
                          value={draftAutoSyncFetchLimit}
                          disabled={settingsLoading || syncFetchLimitSaving}
                          onChange={(event) => setDraftAutoSyncFetchLimit(event.target.value)}
                          className="h-11 rounded-[14px] border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
                        />
                      </label>
                    </div>
                  </div>

                  <div className="border-t border-slate-200/70 pt-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <span className="block text-base font-semibold text-slate-900">清空全部邮件</span>
                        <span className="mt-1 block text-xs text-slate-400">
                          清空所有邮箱账号的本地邮件缓存，不影响邮箱配置和授权信息。
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={openClearAllMessagesDialog}
                        disabled={settingsLoading || syncFetchLimitSaving || deleteMailboxPending}
                        className="shrink-0 rounded-[15px] border border-amber-200 px-4 py-2.5 text-sm font-semibold text-amber-700 transition hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        清空全部邮件
                      </button>
                    </div>
                  </div>

                  <div className="border-t border-slate-200/70 pt-4">
                    <div className="min-w-0">
                      <span className="block text-base font-semibold text-slate-900">备份与恢复</span>
                      <span className="mt-1 block text-xs text-slate-400">
                        备份文件包含本地设置、已保存邮箱配置和本地邮件缓存。
                      </span>
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                      <label className="grid gap-2 rounded-[14px] border border-slate-200/80 bg-slate-50/60 p-3">
                        <span className="text-sm font-medium text-slate-700">选择备份文件</span>
                        <input
                          type="file"
                          accept=".json,application/json"
                          disabled={backupExporting || backupImportingMode !== null}
                          onChange={(event) => void handleBackupFileChange(event)}
                          className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-[12px] file:border-0 file:bg-white file:px-3 file:py-2 file:text-sm file:font-semibold file:text-slate-700"
                        />
                        <span className="text-xs text-slate-400">
                          {backupFileName || "尚未选择备份文件"}
                        </span>
                      </label>

                      <button
                        type="button"
                        onClick={() => void exportBackup()}
                        disabled={backupExporting || backupImportingMode !== null}
                        className="h-fit rounded-[15px] bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {backupExporting ? "导出中..." : "导出备份"}
                      </button>
                    </div>

                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => void importBackup("replace")}
                        disabled={!backupPayload || backupExporting || backupImportingMode !== null}
                        className="rounded-[15px] border border-rose-200 px-4 py-2.5 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {backupImportingMode === "replace" ? "导入中..." : "导入并覆盖"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void importBackup("merge")}
                        disabled={!backupPayload || backupExporting || backupImportingMode !== null}
                        className="rounded-[15px] border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {backupImportingMode === "merge" ? "导入中..." : "导入并合并"}
                      </button>
                    </div>

                    <div className="mt-3 grid gap-2 text-xs text-slate-400">
                      <p>导入并覆盖：会清空当前本地设置、邮箱配置和邮件缓存，再恢复备份内容。</p>
                      <p>导入并合并：会保留当前数据，并按主键更新重复记录。</p>
                    </div>
                  </div>

                  <div className="border-t border-slate-200/70 pt-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <span className="block text-sm font-semibold text-slate-700">新邮件通知</span>
                        <span className="mt-1 block text-xs text-slate-400">
                          {notificationPermission === "unsupported"
                            ? "当前浏览器不支持通知"
                            : notificationPermission === "denied"
                              ? "浏览器已拒绝通知权限"
                              : notificationsEnabled
                                ? "发现新未读邮件时显示系统通知"
                                : "开启后会申请浏览器通知权限"}
                        </span>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={notificationsEnabled}
                        disabled={notificationSaving || notificationPermission === "unsupported"}
                        onClick={() => void updateNotificationsEnabled(!notificationsEnabled)}
                        className={`relative h-7 w-12 shrink-0 rounded-full border transition disabled:cursor-not-allowed disabled:opacity-60 ${
                          notificationsEnabled
                            ? "border-slate-950 bg-slate-950"
                            : "border-slate-200 bg-slate-100"
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 grid h-5.5 w-5.5 place-items-center rounded-full bg-white text-[9px] shadow-sm transition-transform ${
                            notificationsEnabled ? "translate-x-[22px] text-slate-950" : "translate-x-0.5 text-slate-400"
                          }`}
                        >
                          <i
                            className={`fa-solid ${notificationSaving ? "fa-circle-notch fa-spin" : notificationsEnabled ? "fa-bell" : "fa-bell-slash"}`}
                            aria-hidden="true"
                          />
                        </span>
                      </button>
                    </div>
                  </div>
                </div>

                <div className="mt-6 flex items-center justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setIsSettingsOpen(false);
                      setIsSelectOpen(false);
                    }}
                    className="rounded-[15px] bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-900"
                  >
                    完成
                  </button>
                </div>
              </div>
        </DialogTransition>
      ) : null}
    </aside>
  );
}
