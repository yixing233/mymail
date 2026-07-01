import type { MailSourceConfig, ProviderId } from "@/lib/types";

export const defaultSourceConfigs: MailSourceConfig[] = [
  {
    providerId: "gmail",
    mode: "oauth",
    account: "未连接",
    oauthConnected: false,
    authState: "disconnected",
    syncHealth: "healthy",
    lastSyncedAt: "未同步",
  },
  {
    providerId: "outlook",
    mode: "oauth",
    account: "未连接",
    oauthConnected: false,
    authState: "disconnected",
    syncHealth: "healthy",
    lastSyncedAt: "未同步",
  },
  {
    providerId: "qq",
    mode: "imap",
    account: "未连接",
    oauthConnected: false,
    imapHost: "imap.qq.com",
    imapPort: 993,
    authState: "disconnected",
    syncHealth: "healthy",
    lastSyncedAt: "未同步",
  },
  {
    providerId: "mail163",
    mode: "imap",
    account: "未连接",
    oauthConnected: false,
    imapHost: "imap.163.com",
    imapPort: 993,
    authState: "disconnected",
    syncHealth: "healthy",
    lastSyncedAt: "未同步",
  },
];

export const providerScopes: Record<ProviderId, string[]> = {
  gmail: [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/gmail.readonly",
  ],
  outlook: [
    "openid",
    "email",
    "profile",
    "offline_access",
    "https://graph.microsoft.com/User.Read",
    "https://graph.microsoft.com/Mail.Read",
  ],
  qq: [],
  mail163: [],
};
