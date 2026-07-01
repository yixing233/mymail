import type { MailSyncProvider } from "@/lib/sync/base";

export class OutlookSyncProvider implements MailSyncProvider {
  providerId = "outlook" as const;

  async sync() {
    return {
      providerId: this.providerId,
      health: "auth_expired" as const,
      lastSyncedAt: new Date().toISOString(),
      lastError: "Microsoft OAuth refresh token missing.",
      messages: [],
    };
  }
}
