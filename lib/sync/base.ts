import type { MailMessage, ProviderId, SyncHealth } from "@/lib/types";

export interface SyncResult {
  providerId: ProviderId;
  health: SyncHealth;
  lastSyncedAt: string;
  lastError?: string;
  messages: MailMessage[];
}

export interface MailSyncProvider {
  providerId: ProviderId;
  sync(): Promise<SyncResult>;
}
