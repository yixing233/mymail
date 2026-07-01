import { NextResponse } from "next/server";
import { ensureAutoRefreshScheduler } from "@/lib/auto-refresh";
import { syncAllMailboxes } from "@/lib/sync-runner";

export async function POST() {
  ensureAutoRefreshScheduler();
  return NextResponse.json(await syncAllMailboxes());
}
