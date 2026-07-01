import clsx from "clsx";
import type { ProviderStatus, SyncHealth } from "@/lib/types";

const healthLabel: Record<SyncHealth, string> = {
  healthy: "正常",
  rate_limited: "限流",
  offline: "离线",
  auth_expired: "需重连",
  error: "异常",
};

const statusTone: Record<ProviderStatus, string> = {
  connected: "bg-emerald-50 text-emerald-700",
  degraded: "bg-amber-50 text-amber-700",
  disconnected: "bg-slate-100 text-slate-500",
  reauth: "bg-rose-50 text-rose-700",
};

export function StatusBadge({
  status,
  health,
}: {
  status: ProviderStatus;
  health: SyncHealth;
}) {
  const label =
    status === "disconnected"
      ? "未连接"
      : status === "reauth"
        ? "需重连"
        : healthLabel[health];

  return (
    <span className={clsx("rounded-full px-2.5 py-1 text-xs font-semibold", statusTone[status])}>
      {label}
    </span>
  );
}
