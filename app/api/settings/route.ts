import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getAutoSyncFetchLimit,
  getBulkSyncFetchLimit,
  getNotificationsEnabled,
  getRefreshIntervalSeconds,
  getSingleSyncFetchLimit,
  setAutoSyncFetchLimit,
  setBulkSyncFetchLimit,
  setNotificationsEnabled,
  setRefreshIntervalSeconds,
  setSingleSyncFetchLimit,
} from "@/lib/app-settings";
import { buildBackupPayload, importBackupPayload, parseBackupPayload } from "@/lib/backup";
import { clearAllMessages } from "@/lib/provider-store";
import {
  configureAutoRefreshScheduler,
  ensureAutoRefreshScheduler,
  getAutoRefreshStatus,
} from "@/lib/auto-refresh";

const settingsSchema = z.object({
  refreshInterval: z.coerce.number().int().nonnegative().optional(),
  notificationsEnabled: z.boolean().optional(),
  singleSyncFetchLimit: z.coerce.number().int().min(1).max(3).optional(),
  bulkSyncFetchLimit: z.coerce.number().int().min(1).max(3).optional(),
  autoSyncFetchLimit: z.coerce.number().int().min(1).max(3).optional(),
});

const settingsActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("clearAllMessages"),
  }),
  z.object({
    action: z.literal("exportBackup"),
  }),
  z.object({
    action: z.literal("importBackup"),
    mode: z.enum(["replace", "merge"]),
    payload: z.unknown(),
  }),
]);

export async function GET() {
  ensureAutoRefreshScheduler();
  return NextResponse.json({
    refreshInterval: getRefreshIntervalSeconds(),
    notificationsEnabled: getNotificationsEnabled(),
    singleSyncFetchLimit: getSingleSyncFetchLimit(),
    bulkSyncFetchLimit: getBulkSyncFetchLimit(),
    autoSyncFetchLimit: getAutoSyncFetchLimit(),
    autoRefresh: getAutoRefreshStatus(),
  });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const parsed = settingsSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid settings", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const refreshInterval = typeof parsed.data.refreshInterval === "number"
      ? setRefreshIntervalSeconds(parsed.data.refreshInterval)
      : getRefreshIntervalSeconds();
    const notificationsEnabled = typeof parsed.data.notificationsEnabled === "boolean"
      ? setNotificationsEnabled(parsed.data.notificationsEnabled)
      : getNotificationsEnabled();
    const singleSyncFetchLimit = typeof parsed.data.singleSyncFetchLimit === "number"
      ? setSingleSyncFetchLimit(parsed.data.singleSyncFetchLimit)
      : getSingleSyncFetchLimit();
    const bulkSyncFetchLimit = typeof parsed.data.bulkSyncFetchLimit === "number"
      ? setBulkSyncFetchLimit(parsed.data.bulkSyncFetchLimit)
      : getBulkSyncFetchLimit();
    const autoSyncFetchLimit = typeof parsed.data.autoSyncFetchLimit === "number"
      ? setAutoSyncFetchLimit(parsed.data.autoSyncFetchLimit)
      : getAutoSyncFetchLimit();
    const autoRefresh = configureAutoRefreshScheduler(refreshInterval);
    return NextResponse.json({
      refreshInterval,
      notificationsEnabled,
      singleSyncFetchLimit,
      bulkSyncFetchLimit,
      autoSyncFetchLimit,
      autoRefresh,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "保存设置失败" },
      { status: 400 },
    );
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const parsed = settingsActionSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid settings action", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
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

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "操作失败" },
      { status: 400 },
    );
  }
}
