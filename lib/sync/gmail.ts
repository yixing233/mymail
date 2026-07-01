import type { MailSyncProvider } from "@/lib/sync/base";

export class GmailSyncProvider implements MailSyncProvider {
  providerId = "gmail" as const;

  async sync() {
    return {
      providerId: this.providerId,
      health: "healthy" as const,
      lastSyncedAt: new Date().toISOString(),
      messages: [],
    };
  }
}
