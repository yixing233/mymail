import { GmailSyncProvider } from "@/lib/sync/gmail";
import { Mail163ImapSyncProvider } from "@/lib/sync/mail163";
import { OutlookSyncProvider } from "@/lib/sync/outlook";
import { QQImapSyncProvider } from "@/lib/sync/qq";

export const syncProviders = [
  new GmailSyncProvider(),
  new OutlookSyncProvider(),
  new QQImapSyncProvider(),
  new Mail163ImapSyncProvider(),
];
