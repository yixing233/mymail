export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureAutoRefreshScheduler } = await import("./lib/auto-refresh");
    ensureAutoRefreshScheduler();
  }
}
