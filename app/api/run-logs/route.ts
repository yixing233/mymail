import { NextResponse } from "next/server";
import { ensureAutoRefreshScheduler } from "@/lib/auto-refresh";
import { clearServerRunLogs, readServerRunLogs } from "@/lib/server-run-logs";

export async function GET() {
  ensureAutoRefreshScheduler();
  return NextResponse.json({ logs: readServerRunLogs() });
}

export async function DELETE() {
  clearServerRunLogs();
  return NextResponse.json({ success: true });
}
