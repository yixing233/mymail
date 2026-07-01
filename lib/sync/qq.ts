import type { MailSyncProvider } from "@/lib/sync/base";

export class QQImapSyncProvider implements MailSyncProvider {
  providerId = "qq" as const;

  async sync() {
    return {
      providerId: this.providerId,
      health: "rate_limited" as const,
      lastSyncedAt: new Date().toISOString(),
      lastError: "QQ IMAP authorization code cooldown in effect.",
      messages: [],
    };
  }
}
