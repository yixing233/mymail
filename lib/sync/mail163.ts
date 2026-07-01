import type { MailSyncProvider } from "@/lib/sync/base";

export class Mail163ImapSyncProvider implements MailSyncProvider {
  providerId = "mail163" as const;

  async sync() {
    return {
      providerId: this.providerId,
      health: "offline" as const,
      lastSyncedAt: new Date().toISOString(),
      lastError: "163 IMAP endpoint unreachable.",
      messages: [],
    };
  }
}
