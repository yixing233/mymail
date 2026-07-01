export type ProviderId = "gmail" | "outlook" | "qq" | "mail163";

export type ProviderStatus = "connected" | "degraded" | "disconnected" | "reauth";

export type SyncHealth = "healthy" | "rate_limited" | "offline" | "auth_expired" | "error";

export type SyncMode = "oauth" | "imap";

export type OutlookSyncMode = "graph" | "imap";

export type MailFilter = "all" | "unread" | "attachments" | "verification";

export interface MailProvider {
  id: ProviderId;
  label: string;
  mode: SyncMode;
  address: string;
  status: ProviderStatus;
  health: SyncHealth;
  unreadCount: number;
  lastSyncedAt: string;
  lastError?: string;
  accent: string;
  authHint: string;
}

export interface MailMailbox {
  id: string;
  providerId: ProviderId;
  account: string;
  status: ProviderStatus;
  health: SyncHealth;
  unreadCount: number;
  lastSyncedAt: string;
  lastError?: string;
  syncFetchLimit?: number;
}

export interface MailProviderGroup {
  id: ProviderId;
  label: string;
  mode: SyncMode;
  unreadCount: number;
  lastSyncedAt: string;
  lastError?: string;
  accent: string;
  authHint: string;
  mailboxes: MailMailbox[];
}

export interface MailAttachment {
  id: string;
  name: string;
  sizeLabel: string;
}

export interface MailMessage {
  id: string;
  providerId: ProviderId;
  mailboxId: string;
  remoteId?: string;
  remoteFolder?: string;
  providerLabel: string;
  from: string;
  subject: string;
  preview: string;
  receivedAt: string;
  unread: boolean;
  hasAttachments: boolean;
  tags: string[];
  attachments: MailAttachment[];
}

export interface MailDetail extends MailMessage {
  html: string;
  text: string;
}

export interface MailSourceConfig {
  providerId: ProviderId;
  mode: SyncMode;
  account: string;
  oauthConnected: boolean;
  imapHost?: string;
  imapPort?: number;
  authState: ProviderStatus;
  syncHealth: SyncHealth;
  lastSyncedAt: string;
  lastError?: string;
  syncFetchLimit?: number;
}

export interface InboxPayload {
  providers: MailProviderGroup[];
  messages: MailMessage[];
  selectedMessage?: MailDetail;
}
