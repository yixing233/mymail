import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { getMailboxConfig, getProviderConfig, getProviderPayload, getProviderSecrets, getStoredMessageRow, renderTextFallback, replaceMailboxMessages, updateMessageDetail, updateProviderConnectionState } from "@/lib/provider-store";
import { providerScopes } from "@/lib/data";
import type { MailDetail, MailMessage, ProviderId } from "@/lib/types";

interface RefreshProviderOptions {
  limit?: number;
}

function normalizeFetchLimit(limit?: number) {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return 3;
  return Math.max(1, Math.min(3, Math.trunc(limit)));
}

const providerLabels: Record<ProviderId, string> = {
  gmail: "Gmail",
  outlook: "Outlook",
  qq: "QQ Mail",
  mail163: "163 Mail",
};

const globalForSync = globalThis as typeof globalThis & {
  __mymailProviderRefreshes?: Map<string, Promise<unknown>>;
};

function getRefreshLocks() {
  globalForSync.__mymailProviderRefreshes ??= new Map<string, Promise<unknown>>();
  return globalForSync.__mymailProviderRefreshes;
}

interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

async function getOAuthErrorMessage(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null) as
    | { error?: string; error_description?: string; error_codes?: number[] }
    | null;
  const details = [payload?.error, payload?.error_description].filter(Boolean).join(": ");
  return details || `${fallback} (${response.status})`;
}

interface GmailProfileResponse {
  emailAddress: string;
}

interface GmailListResponse {
  messages?: Array<{ id: string; threadId: string }>;
}

const gmailSyncLabels = ["INBOX", "SPAM"] as const;
const outlookSyncFolders = ["inbox", "junkemail"] as const;
const defaultImapSyncMailboxes = ["INBOX", "Junk", "Spam", "Bulk Mail", "Junk E-mail", "Junk Email", "Deleted Messages", "Trash"] as const;
const providerImapSyncMailboxes: Record<ProviderId, readonly string[]> = {
  gmail: defaultImapSyncMailboxes,
  outlook: ["INBOX", "Junk", "Junk Email", "Junk E-mail", "Deleted Messages"],
  qq: ["INBOX", "Junk", "Spam"],
  mail163: ["INBOX", "Spam", "Bulk Mail", "Trash"],
};
const gmailSummaryConcurrency = 8;

interface GmailMessageResponse {
  id: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  raw?: string;
  payload?: {
    headers?: Array<{ name?: string; value?: string }>;
  };
}

interface OutlookProfileResponse {
  userPrincipalName?: string;
  mail?: string;
}

interface OutlookMessageResponse {
  value?: OutlookMessageItem[];
}

interface OutlookMessageItem {
  id: string;
  subject?: string;
  bodyPreview?: string;
  receivedDateTime?: string;
  from?: {
    emailAddress?: {
      name?: string;
      address?: string;
    };
  };
  isRead?: boolean;
  hasAttachments?: boolean;
  body?: {
    contentType?: "html" | "text";
    content?: string;
  };
}

interface OutlookAttachmentResponse {
  value?: Array<{
    id: string;
    name?: string;
    size?: number;
  }>;
}

function buildFallbackHtml(text: string, subject: string) {
  return renderTextFallback(text || subject);
}

function normalizeParsedHtml(html: string | false | undefined | null, fallbackText: string, subject: string) {
  if (typeof html === "string" && html.trim() && html.trim() !== "false") {
    return html;
  }

  return buildFallbackHtml(fallbackText, subject);
}

function buildTextFromHtml(html: string, fallbackText: string) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || fallbackText;
}

async function parseRawMessageBody(source: Buffer | undefined, fallbackText: string, subject: string) {
  if (!source) {
    return {
      text: fallbackText,
      html: buildFallbackHtml(fallbackText, subject),
    };
  }

  const parsed = await simpleParser(source);
  const text = parsed.text || (typeof parsed.html === "string" ? buildTextFromHtml(parsed.html, fallbackText) : fallbackText);
  const html = normalizeParsedHtml(parsed.html, text, subject);
  return { parsed, text, html };
}

async function fetchImapMessageSource(client: ImapFlow, uid: number | string | undefined) {
  if (uid === undefined || uid === null) {
    return undefined;
  }

  try {
    for await (const message of client.fetch(String(uid), { source: true }, { uid: true })) {
      return message.source;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function buildAttachmentList(
  messageId: string,
  attachments: Array<{ id?: string; name?: string; size?: number }>,
) {
  return attachments.map((attachment, index) => ({
    id: `${messageId}-${attachment.id || index}`,
    name: attachment.name || `attachment-${index + 1}`,
    sizeLabel: `${Math.max(1, Math.round((attachment.size || 0) / 1024))} KB`,
  }));
}

function getHeaderValue(headers: Array<{ name?: string; value?: string }> | undefined, name: string) {
  const match = headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase());
  return match?.value;
}

function sortMessagesByReceivedAtDesc<T extends { receivedAt: string }>(messages: T[]) {
  return [...messages].sort((left, right) => {
    const leftTime = Date.parse(left.receivedAt);
    const rightTime = Date.parse(right.receivedAt);
    return rightTime - leftTime;
  });
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
) {
  if (items.length === 0) {
    return [] as R[];
  }

  const resolvedConcurrency = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: resolvedConcurrency }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await mapper(items[currentIndex], currentIndex);
      }
    }),
  );

  return results;
}

export function getOutlookImapScopes() {
  return [
    "https://outlook.office.com/IMAP.AccessAsUser.All",
    "offline_access",
  ];
}

export function buildOutlookRefreshParams(input: {
  clientId: string;
  clientSecret?: string;
  refreshToken: string;
  scopes?: string[];
}) {
  const params = new URLSearchParams({
    client_id: input.clientId,
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
  });

  if (input.scopes?.length) {
    params.set("scope", input.scopes.join(" "));
  }

  if (input.clientSecret) {
    params.set("client_secret", input.clientSecret);
  }

  return params;
}

export function shouldUseOutlookRefreshScopes(input: {
  payloadClientId?: string;
  builtinClientId?: string;
  payloadScopes?: string[];
}) {
  if (input.payloadScopes?.length) {
    return true;
  }

  return !input.payloadClientId || input.payloadClientId === input.builtinClientId;
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  return Buffer.from(padded, "base64");
}

async function getGraphErrorMessage(response: Response) {
  const payload = await response.json().catch(() => null) as
    | { error?: { code?: string; message?: string } }
    | null;
  const code = payload?.error?.code;
  const message = payload?.error?.message;

  if (
    response.status === 404 ||
    code === "MailboxNotEnabledForRESTAPI" ||
    code === "ErrorMailboxNotEnabledForRESTAPI" ||
    message?.toLowerCase().includes("mailbox")
  ) {
    return "当前 Microsoft 账号没有可读取的 Graph 邮箱。";
  }

  return message || "Microsoft Graph 邮件读取失败";
}

async function verifyImap(providerId: ProviderId, mailboxId?: string) {
  const config = mailboxId ? getMailboxConfig(providerId, mailboxId) : getProviderConfig(providerId);
  const secrets = getProviderSecrets(providerId, mailboxId);
  const payload = getProviderPayload(providerId, mailboxId);
  const password = secrets.authorizationCode || secrets.password;

  const outlookToken =
    providerId === "outlook" && payload.clientId && secrets.refreshToken
      ? await refreshOutlookImapAccessToken(payload.clientId, payload.tenantId || "common", secrets)
      : undefined;
  const accessToken = outlookToken?.access_token;

  if (!config.account || !payload.imapHost || !payload.imapPort || (!password && !accessToken)) {
    throw new Error("IMAP 配置不完整");
  }


  let client = new ImapFlow({
    host: payload.imapHost,
    port: payload.imapPort,
    secure: true,
    auth: {
      user: config.account,
      pass: accessToken ? undefined : password,
      accessToken,
    },
    logger: false,
  });

  try {
    await client.connect();
    await client.mailboxOpen("INBOX");
    const mailbox = client.mailbox ? client.mailbox.exists : 0;
    await client.logout();
    updateProviderConnectionState({
      providerId,
      mailboxId,
      account: config.account,
      status: "connected",
      health: "healthy",
      lastSyncedAt: new Date().toISOString(),
      lastError: null,
      tokenPayload: outlookToken
        ? {
            accessToken: outlookToken.access_token,
            tokenType: outlookToken.token_type,
            expiryDate: Date.now() + outlookToken.expires_in * 1000,
            refreshToken: outlookToken.refresh_token ?? secrets.refreshToken,
          }
        : undefined,
    });
    return { mailbox };
  } catch (error) {
    client.close();
    const message = error instanceof Error ? error.message : "IMAP 连接失败";
    updateProviderConnectionState({
      providerId,
      mailboxId,
      account: config.account,
      status: "degraded",
      health: "error",
      lastSyncedAt: new Date().toISOString(),
      lastError: message,
    });
    throw new Error(message);
  }
}

async function fetchImapMessages(providerId: ProviderId, mailboxId?: string, options?: RefreshProviderOptions) {
  const resolvedMailboxId = mailboxId ?? providerId;
  const config = mailboxId ? getMailboxConfig(providerId, mailboxId) : getProviderConfig(providerId);
  const secrets = getProviderSecrets(providerId, mailboxId);
  const payload = getProviderPayload(providerId, mailboxId);
  const password = secrets.authorizationCode || secrets.password;

  const outlookToken =
    providerId === "outlook" && payload.clientId && secrets.refreshToken
      ? await refreshOutlookImapAccessToken(payload.clientId, payload.tenantId || "common", secrets)
      : undefined;
  const accessToken = outlookToken?.access_token;

  if (!config.account || !payload.imapHost || !payload.imapPort || (!password && !accessToken)) {
    throw new Error("IMAP 配置不完整");
  }

  const imapHost = payload.imapHost;
  const imapPort = payload.imapPort;
  const fetchLimit = normalizeFetchLimit(options?.limit);
  const syncMailboxes = providerImapSyncMailboxes[providerId] || defaultImapSyncMailboxes;

  const createClient = (useAccessToken: boolean) => new ImapFlow({
    host: imapHost,
    port: imapPort,
    secure: true,
    auth: {
      user: config.account,
      pass: useAccessToken ? undefined : password,
      accessToken: useAccessToken ? accessToken : undefined,
    },
    logger: false,
  });

  async function syncWithClient(activeClient: ImapFlow) {
    const collected: Array<MailMessage & Pick<MailDetail, "text" | "html">> = [];
    const legacyMessageIds: string[] = [];
    const seenMessageIds = new Set<string>();

    for (const mailboxName of syncMailboxes) {
      if (collected.length >= fetchLimit) {
        break;
      }

      let total = 0;
      try {
        const mailbox = await client.mailboxOpen(mailboxName);
        const openedCount = mailbox && typeof mailbox === "object" ? mailbox.exists : undefined;
        const selectedMailbox = client.mailbox;
        const selectedCount = selectedMailbox && typeof selectedMailbox === "object" ? selectedMailbox.exists : undefined;
        total = Number(openedCount ?? selectedCount ?? 0);
      } catch {
        continue;
      }

      if (!Number.isFinite(total) || total <= 0) {
        continue;
      }

      const start = Math.max(total - (fetchLimit - 1), 1);

      for await (const message of client.fetch(`${start}:*`, {
        uid: true,
        envelope: true,
        flags: true,
        internalDate: true,
      })) {
        if (collected.length >= fetchLimit) {
          break;
        }

        const dedupeKey = `${mailboxName}:${message.uid}`;
        if (seenMessageIds.has(dedupeKey)) {
          continue;
        }
        seenMessageIds.add(dedupeKey);

        const from = message.envelope?.from?.[0]?.address || config.account;
        const subject = message.envelope?.subject || "(无主题)";
        const preview = subject.replace(/\s+/g, " ").trim().slice(0, 140);
        const messageId = `${resolvedMailboxId}-${mailboxName}-${message.uid}`;
        const receivedAt = new Date(message.internalDate || Date.now()).toISOString();
        const source = message.source ?? await fetchImapMessageSource(client, message.uid);
        const body = await parseRawMessageBody(source, preview, subject);
        legacyMessageIds.push(`${providerId}-${message.uid}`);

        collected.push({
          id: messageId,
          providerId,
          mailboxId: resolvedMailboxId,
          remoteId: String(message.uid),
          remoteFolder: mailboxName,
          providerLabel: providerLabels[providerId],
          from,
          subject,
          preview,
          receivedAt,
          unread: !message.flags?.has("\Seen"),
          hasAttachments: false,
          tags: [],
          attachments: [],
          text: body.text,
          html: body.html,
        });
      }
    }

    await client.logout();
    const limited = sortMessagesByReceivedAtDesc(collected).slice(0, fetchLimit);
    const limitedIds = new Set(limited.map((message) => message.id));
    const limitedLegacyIds = legacyMessageIds.filter((_legacyId, index) => limitedIds.has(collected[index]?.id));
    replaceMailboxMessages(resolvedMailboxId, providerId, limited, limitedLegacyIds);
    updateProviderConnectionState({
      providerId,
      mailboxId,
      account: config.account,
      status: "connected",
      health: "healthy",
      lastSyncedAt: new Date().toISOString(),
      lastError: null,
      tokenPayload: outlookToken
        ? {
            accessToken: outlookToken.access_token,
            tokenType: outlookToken.token_type,
            expiryDate: Date.now() + outlookToken.expires_in * 1000,
            refreshToken: outlookToken.refresh_token ?? secrets.refreshToken,
          }
        : undefined,
    });
    return { count: limited.length };
  }

  let usingAccessToken = Boolean(accessToken);
  let client = createClient(usingAccessToken);

  try {
    try {
      await client.connect();
    } catch (error) {
      if (providerId !== "outlook" || !usingAccessToken || !password) {
        throw error;
      }

      client.close();
      usingAccessToken = false;
      client = createClient(false);
      await client.connect();
    }

    return await syncWithClient(client);
  } catch (error) {
    if (providerId === "outlook" && usingAccessToken && password) {
      client.close();
      usingAccessToken = false;
      client = createClient(false);

      try {
        await client.connect();
        return await syncWithClient(client);
      } catch (retryError) {
        client.close();
        const message = retryError instanceof Error ? retryError.message : "IMAP 拉取失败";
        updateProviderConnectionState({
          providerId,
          mailboxId,
          account: config.account,
          status: "degraded",
          health: "error",
          lastSyncedAt: new Date().toISOString(),
          lastError: message,
        });
        throw new Error(message);
      }
    }

    client.close();
    const message = error instanceof Error ? error.message : "IMAP 拉取失败";
    updateProviderConnectionState({
      providerId,
      mailboxId,
      account: config.account,
      status: "degraded",
      health: "error",
      lastSyncedAt: new Date().toISOString(),
      lastError: message,
    });
    throw new Error(message);
  }
}

async function refreshOutlookImapAccessToken(
  clientId: string,
  tenantId: string,
  secrets: { clientSecret?: string; refreshToken?: string },
) {
  if (!secrets.refreshToken) {
    throw new Error("请重新导入 Outlook IMAP 凭据");
  }

  const tokenResponse = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: buildOutlookRefreshParams({
      clientId,
      clientSecret: secrets.clientSecret,
      refreshToken: secrets.refreshToken,
      scopes: getOutlookImapScopes(),
    }),
  });

  if (!tokenResponse.ok) {
    throw new Error(await getOAuthErrorMessage(tokenResponse, "Outlook IMAP token refresh failed"));
  }

  return (await tokenResponse.json()) as OAuthTokenResponse;
}

async function refreshGoogle(providerId: ProviderId, mailboxId?: string, options?: RefreshProviderOptions) {
  const resolvedMailboxId = mailboxId ?? providerId;
  const config = mailboxId ? getMailboxConfig(providerId, mailboxId) : getProviderConfig(providerId);
  const payload = getProviderPayload(providerId, mailboxId);
  const secrets = getProviderSecrets(providerId, mailboxId);
  const builtinClientId = process.env.MYMAIL_GMAIL_CLIENT_ID;

  if (!payload.clientId || !secrets.refreshToken) {
    const message = "请重新授权 Google 账号";
    updateProviderConnectionState({
      providerId,
      mailboxId,
      status: "reauth",
      health: "auth_expired",
      lastSyncedAt: new Date().toISOString(),
      lastError: message,
    });
    throw new Error(message);
  }

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: payload.clientId,
      client_secret: payload.clientId === builtinClientId ? process.env.MYMAIL_GMAIL_CLIENT_SECRET || "" : "",
      grant_type: "refresh_token",
      refresh_token: secrets.refreshToken,
    }),
  });

  if (!tokenResponse.ok) {
    const message = await getOAuthErrorMessage(tokenResponse, "Google refresh failed");
    updateProviderConnectionState({
      providerId,
      mailboxId,
      status: "reauth",
      health: "auth_expired",
      lastSyncedAt: new Date().toISOString(),
      lastError: message,
    });
    throw new Error(message);
  }

  const token = (await tokenResponse.json()) as OAuthTokenResponse;
  const profileResponse = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
    },
  });

  if (!profileResponse.ok) {
    throw new Error("Google verify failed");
  }

  const profile = (await profileResponse.json()) as GmailProfileResponse;
  const fetchLimit = normalizeFetchLimit(options?.limit);
  const collected: Array<MailMessage & Pick<MailDetail, "text" | "html">> = [];
  const listResults = await Promise.all(gmailSyncLabels.map(async (labelId) => {
    const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    listUrl.searchParams.set("maxResults", String(fetchLimit));
    listUrl.searchParams.set("labelIds", labelId);

    const listResponse = await fetch(listUrl, {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
      },
    });

    if (!listResponse.ok) {
      throw new Error("Google message list failed");
    }

    const list = (await listResponse.json()) as GmailListResponse;
    return { labelId, messages: list.messages ?? [] };
  }));

  const seenMessageIds = new Set<string>();
  const summaryTargets = listResults.flatMap(({ labelId, messages }) =>
    messages.flatMap((item) => {
      if (seenMessageIds.has(item.id)) {
        return [];
      }
      seenMessageIds.add(item.id);
      return [{ item, labelId }];
    }),
  ).slice(0, fetchLimit);

  const messages = await mapWithConcurrency(summaryTargets, gmailSummaryConcurrency, async ({ item, labelId }) => {
    const messageResponse = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(item.id)}?format=raw`,
      {
        headers: {
          Authorization: `Bearer ${token.access_token}`,
        },
      },
    );

    if (!messageResponse.ok) {
      throw new Error("Google message fetch failed");
    }

    const message = (await messageResponse.json()) as GmailMessageResponse;
    return { labelId, item, message };
  });

  for (const { labelId, item, message } of messages) {
    const parsed = message.raw ? await simpleParser(decodeBase64Url(message.raw)) : null;
    const subject = parsed?.subject || "(无主题)";
    const from = parsed?.from?.text || profile.emailAddress;
    const bodyText = parsed?.text || message.snippet || subject;
    const html = normalizeParsedHtml(parsed?.html, bodyText, subject);
    const preview = (message.snippet || bodyText || subject).replace(/\s+/g, " ").trim().slice(0, 140);
    const receivedAt = new Date(message.internalDate ? Number(message.internalDate) : Date.now()).toISOString();
    const messageId = `${resolvedMailboxId}-${item.id}`;

    collected.push({
      id: messageId,
      providerId,
      mailboxId: resolvedMailboxId,
      remoteId: item.id,
      remoteFolder: labelId,
      providerLabel: providerLabels[providerId],
      from,
      subject,
      preview,
      receivedAt,
      unread: Boolean(message.labelIds?.includes("UNREAD")),
      hasAttachments: false,
      tags: [],
      attachments: [],
      text: bodyText,
      html,
    });
  }

  const limited = sortMessagesByReceivedAtDesc(collected).slice(0, fetchLimit);
  replaceMailboxMessages(resolvedMailboxId, providerId, limited);
  updateProviderConnectionState({
    providerId,
    mailboxId,
    account: profile.emailAddress,
    status: "connected",
    health: "healthy",
    lastSyncedAt: new Date().toISOString(),
    lastError: null,
    tokenPayload: {
      accessToken: token.access_token,
      tokenType: token.token_type,
      expiryDate: Date.now() + token.expires_in * 1000,
      refreshToken: token.refresh_token ?? secrets.refreshToken,
    },
  });
  return { count: limited.length };
}

async function refreshOutlook(providerId: ProviderId, mailboxId?: string, options?: RefreshProviderOptions) {
  const resolvedMailboxId = mailboxId ?? providerId;
  const config = mailboxId ? getMailboxConfig(providerId, mailboxId) : getProviderConfig(providerId);
  const payload = getProviderPayload(providerId, mailboxId);
  const secrets = getProviderSecrets(providerId, mailboxId);
  const tenantId = payload.tenantId || "common";
  const builtinClientId = process.env.MYMAIL_OUTLOOK_CLIENT_ID;
  const refreshScopes = shouldUseOutlookRefreshScopes({
    payloadClientId: payload.clientId,
    builtinClientId,
    payloadScopes: payload.scopes,
  })
    ? payload.scopes
    : undefined;

  if (!payload.clientId || !secrets.refreshToken) {
    const message = "请重新授权 Outlook 账号";
    updateProviderConnectionState({
      providerId,
      mailboxId,
      status: "reauth",
      health: "auth_expired",
      lastSyncedAt: new Date().toISOString(),
      lastError: message,
    });
    throw new Error(message);
  }

  const tokenResponse = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: buildOutlookRefreshParams({
      clientId: payload.clientId,
      clientSecret: payload.clientId === builtinClientId ? process.env.MYMAIL_OUTLOOK_CLIENT_SECRET : undefined,
      refreshToken: secrets.refreshToken,
      scopes: refreshScopes,
    }),
  });

  if (!tokenResponse.ok) {
    const message = await getOAuthErrorMessage(tokenResponse, "Outlook refresh failed");
    updateProviderConnectionState({
      providerId,
      mailboxId,
      status: "reauth",
      health: "auth_expired",
      lastSyncedAt: new Date().toISOString(),
      lastError: message,
    });
    throw new Error(message);
  }

  const token = (await tokenResponse.json()) as OAuthTokenResponse;
  const profileResponse = await fetch("https://graph.microsoft.com/v1.0/me?$select=userPrincipalName,mail", {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
    },
  });

  if (!profileResponse.ok) {
    const message = await getGraphErrorMessage(profileResponse);
    throw new Error(message);
  }

  const profile = (await profileResponse.json()) as OutlookProfileResponse;
  const account = profile?.mail || profile?.userPrincipalName || config.account || "";
  const fetchLimit = normalizeFetchLimit(options?.limit);
  const collected: Array<MailMessage & Pick<MailDetail, "text" | "html">> = [];
  const seenMessageIds = new Set<string>();

  for (const folderId of outlookSyncFolders) {
    if (collected.length >= fetchLimit) {
      break;
    }

    const listUrl = new URL(`https://graph.microsoft.com/v1.0/me/mailFolders/${folderId}/messages`);
    listUrl.searchParams.set("$top", String(fetchLimit));
    listUrl.searchParams.set("$orderby", "receivedDateTime desc");
    listUrl.searchParams.set(
      "$select",
      "id,subject,bodyPreview,receivedDateTime,from,isRead,hasAttachments,body",
    );

    const listResponse = await fetch(listUrl, {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        Prefer: 'outlook.body-content-type="html"',
      },
    });

    if (!listResponse.ok) {
      const message = await getGraphErrorMessage(listResponse);
      updateProviderConnectionState({
        providerId,
        mailboxId,
        account,
        status: "degraded",
        health: "error",
        lastSyncedAt: new Date().toISOString(),
        lastError: message,
        tokenPayload: {
          accessToken: token.access_token,
          tokenType: token.token_type,
          expiryDate: Date.now() + token.expires_in * 1000,
          refreshToken: token.refresh_token ?? secrets.refreshToken,
        },
      });
      throw new Error(message);
    }

    const list = (await listResponse.json()) as OutlookMessageResponse;

    for (const message of list.value ?? []) {
      if (collected.length >= fetchLimit) {
        break;
      }

      if (seenMessageIds.has(message.id)) {
        continue;
      }
      seenMessageIds.add(message.id);

      const fromName = message.from?.emailAddress?.name;
      const fromAddress = message.from?.emailAddress?.address;
      const from = fromName && fromAddress ? `"${fromName}" <${fromAddress}>` : fromAddress || fromName || account;
      const subject = message.subject || "(无主题)";
      const preview = (message.bodyPreview || subject).replace(/\s+/g, " ").trim().slice(0, 140);
      const text = message.bodyPreview || subject;
      const html = message.body?.contentType === "html" && message.body.content
        ? message.body.content
        : buildFallbackHtml(text, subject);
      const messageId = `${resolvedMailboxId}-${message.id}`;

      collected.push({
        id: messageId,
        providerId,
        mailboxId: resolvedMailboxId,
        remoteId: message.id,
        remoteFolder: folderId,
        providerLabel: providerLabels[providerId],
        from,
        subject,
        preview,
        receivedAt: new Date(message.receivedDateTime || Date.now()).toISOString(),
        unread: !message.isRead,
        hasAttachments: Boolean(message.hasAttachments),
        tags: [],
        attachments: [],
        text,
        html,
      });
    }
  }

  const limited = sortMessagesByReceivedAtDesc(collected).slice(0, fetchLimit);
  replaceMailboxMessages(resolvedMailboxId, providerId, limited);
  updateProviderConnectionState({
    providerId,
    mailboxId,
    account,
    status: "connected",
    health: "healthy",
    lastSyncedAt: new Date().toISOString(),
    lastError: null,
    tokenPayload: {
      accessToken: token.access_token,
      tokenType: token.token_type,
      expiryDate: Date.now() + token.expires_in * 1000,
      refreshToken: token.refresh_token ?? secrets.refreshToken,
    },
  });
  return { count: limited.length };
}

async function refreshProviderNow(providerId: ProviderId, mailboxId?: string, options?: RefreshProviderOptions) {
  const config = mailboxId ? getMailboxConfig(providerId, mailboxId) : getProviderConfig(providerId);

  if (config.mode === "imap") {
    return fetchImapMessages(providerId, mailboxId, options);
  }

  if (providerId === "gmail") {
    return refreshGoogle(providerId, mailboxId, options);
  }

  if (providerId === "outlook") {
    return refreshOutlook(providerId, mailboxId, options);
  }

  throw new Error("Unsupported provider");
}

interface ImapHydrateMessage {
  uid?: number;
  source?: Buffer;
  envelope?: {
    from?: Array<{ address?: string }>;
    subject?: string;
  };
  flags?: Set<string>;
  internalDate?: Date | string | number;
}

function normalizeComparableText(value?: string | null) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function getTimeDistance(left?: Date | string | number, right?: string | null) {
  const leftTime = left ? new Date(left).getTime() : Number.NaN;
  const rightTime = right ? new Date(right).getTime() : Number.NaN;
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.abs(leftTime - rightTime);
}

function isImapFallbackCandidate(message: ImapHydrateMessage, row: NonNullable<ReturnType<typeof getStoredMessageRow>>) {
  if (!message.source) {
    return false;
  }

  const candidateSubject = normalizeComparableText(message.envelope?.subject);
  const storedSubject = normalizeComparableText(row.subject);
  return Boolean(candidateSubject && storedSubject && candidateSubject === storedSubject);
}

async function fetchImapHydrateMessage(
  client: {
    mailbox?: false | { exists?: number };
    fetchOne: (
      range: string,
      query: { uid: true; source: true; envelope: true; flags: true; internalDate: true },
      options: { uid: true },
    ) => Promise<ImapHydrateMessage | false>;
    fetch: (
      range: string,
      query: { uid: true; source: true; envelope: true; flags: true; internalDate: true },
    ) => AsyncIterable<ImapHydrateMessage>;
  },
  row: NonNullable<ReturnType<typeof getStoredMessageRow>>,
) {
  let directError: unknown;
  const detailQuery = {
    uid: true,
    source: true,
    envelope: true,
    flags: true,
    internalDate: true,
  } as const;

  try {
    if (row.remote_id) {
      const message = await client.fetchOne(row.remote_id, detailQuery, { uid: true });
      if (message && message.source) {
        return message;
      }
    }
  } catch (error) {
    directError = error;
  }

  const total = Math.max(0, Number(client.mailbox && typeof client.mailbox === "object" ? client.mailbox.exists || 0 : 0));
  if (total > 0) {
    const start = Math.max(total - 49, 1);
    const candidates: ImapHydrateMessage[] = [];

    for await (const message of client.fetch(`${start}:*`, detailQuery)) {
      if (isImapFallbackCandidate(message, row)) {
        candidates.push(message);
      }
    }

    candidates.sort((left, right) => (
      getTimeDistance(left.internalDate, row.received_at) - getTimeDistance(right.internalDate, row.received_at)
    ));

    if (candidates[0]) {
      return candidates[0];
    }
  }

  if (directError) {
    throw directError;
  }

  return false;
}

async function hydrateImapMessageDetail(messageId: string, row: NonNullable<ReturnType<typeof getStoredMessageRow>>) {
  const providerId = row.provider_id;
  const config = getMailboxConfig(providerId, row.mailbox_id);
  const secrets = getProviderSecrets(providerId, row.mailbox_id);
  const payload = getProviderPayload(providerId, row.mailbox_id);
  const password = secrets.authorizationCode || secrets.password;
  const outlookToken =
    providerId === "outlook" && payload.clientId && secrets.refreshToken
      ? await refreshOutlookImapAccessToken(payload.clientId, payload.tenantId || "common", secrets)
      : undefined;
  const accessToken = outlookToken?.access_token;

  if (!config.account || !payload.imapHost || !payload.imapPort || !row.remote_id || (!password && !accessToken)) {
    return;
  }

  let client = new ImapFlow({
    host: payload.imapHost,
    port: payload.imapPort,
    secure: true,
    auth: {
      user: config.account,
      pass: accessToken ? undefined : password,
      accessToken,
    },
    logger: false,
  });

  try {
    try {
      await client.connect();
    } catch (error) {
      if (providerId !== "outlook" || !accessToken || !password) {
        throw error;
      }

      client.close();
      client = new ImapFlow({
        host: payload.imapHost,
        port: payload.imapPort,
        secure: true,
        auth: {
          user: config.account,
          pass: password,
        },
        logger: false,
      });
      await client.connect();
    }
    await client.mailboxOpen(row.remote_folder || "INBOX", { readOnly: true });
    const message = await fetchImapHydrateMessage(client, row);
    if (!message || !message.source) {
      await client.logout();
      return;
    }

    const parsed = await simpleParser(message.source);
    const subject = parsed.subject || message.envelope?.subject || row.subject || "(无主题)";
    const text = parsed.text || row.preview || subject;
    const html = normalizeParsedHtml(parsed.html, text, subject);
    const attachments = buildAttachmentList(
      messageId,
      parsed.attachments?.map((attachment: { filename?: string | null; size?: number }, index: number) => ({
        id: String(index),
        name: attachment.filename || `attachment-${index + 1}`,
        size: attachment.size || 0,
      })) || [],
    );

    updateMessageDetail(messageId, {
      from: parsed.from?.text || message.envelope?.from?.[0]?.address,
      subject,
      preview: (text || subject).replace(/\s+/g, " ").trim().slice(0, 140),
      receivedAt: parsed.date
        ? parsed.date.toISOString()
        : message.internalDate
          ? new Date(message.internalDate).toISOString()
          : undefined,
      unread: message.flags ? !message.flags.has("\\Seen") : undefined,
      hasAttachments: attachments.length > 0,
      attachments,
      text,
      html,
    });
    await client.logout();
  } catch (error) {
    client.close();
    const reason = error instanceof Error ? error.message : "unknown error";
    throw new Error(`IMAP hydrate failed for ${providerId} message ${messageId}: ${reason}`);
  }
}

export async function refreshProvider(providerId: ProviderId, mailboxId?: string, options?: RefreshProviderOptions) {
  const fetchLimit = normalizeFetchLimit(options?.limit);
  const key = `${providerId}:${mailboxId ?? ""}:${fetchLimit}`;
  const locks = getRefreshLocks();
  const existing = locks.get(key);
  if (existing) {
    return existing;
  }

  const refresh = refreshProviderNow(providerId, mailboxId, { limit: fetchLimit }).finally(() => {
    locks.delete(key);
  });
  locks.set(key, refresh);
  return refresh;
}

export async function verifyImapOnSave(providerId: ProviderId, mailboxId?: string) {
  return verifyImap(providerId, mailboxId);
}

export async function hydrateMessageDetail(messageId: string) {
  const row = getStoredMessageRow(messageId);
  if (!row || (row.text_content && row.html_content)) {
    return;
  }

  const config = getMailboxConfig(row.provider_id, row.mailbox_id);
  if (config.mode === "imap") {
    await hydrateImapMessageDetail(messageId, row);
    return;
  }

  if (row.provider_id === "gmail") {
    const payload = getProviderPayload("gmail", row.mailbox_id);
    const secrets = getProviderSecrets("gmail", row.mailbox_id);
    const builtinClientId = process.env.MYMAIL_GMAIL_CLIENT_ID;
    if (!payload.clientId || !secrets.refreshToken || !row.remote_id) return;

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: payload.clientId,
        client_secret: payload.clientId === builtinClientId ? process.env.MYMAIL_GMAIL_CLIENT_SECRET || "" : "",
        grant_type: "refresh_token",
        refresh_token: secrets.refreshToken,
      }),
    });
    if (!tokenResponse.ok) return;

    const token = (await tokenResponse.json()) as OAuthTokenResponse;
    const messageResponse = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(row.remote_id)}?format=raw`,
      { headers: { Authorization: `Bearer ${token.access_token}` } },
    );
    if (!messageResponse.ok) return;

    const message = (await messageResponse.json()) as GmailMessageResponse;
    const parsed = message.raw ? await simpleParser(decodeBase64Url(message.raw)) : null;
    const subject = parsed?.subject || row.subject || "(无主题)";
    const text = parsed?.text || message.snippet || row.preview || "";
    const html = normalizeParsedHtml(parsed?.html, text, subject);
    const attachments = buildAttachmentList(
      messageId,
      parsed?.attachments?.map((attachment: { filename?: string | null; size?: number }, index: number) => ({
        id: String(index),
        name: attachment.filename || `attachment-${index + 1}`,
        size: attachment.size || 0,
      })) || [],
    );

    updateMessageDetail(messageId, {
      from: parsed?.from?.text,
      subject,
      preview: (text || subject).replace(/\s+/g, " ").trim().slice(0, 140),
      receivedAt: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : undefined,
      unread: Boolean(message.labelIds?.includes("UNREAD")),
      hasAttachments: attachments.length > 0,
      attachments,
      text,
      html,
    });
    return;
  }

  if (row.provider_id === "outlook") {
    const payload = getProviderPayload("outlook", row.mailbox_id);
    const secrets = getProviderSecrets("outlook", row.mailbox_id);
    const tenantId = payload.tenantId || "common";
    const builtinClientId = process.env.MYMAIL_OUTLOOK_CLIENT_ID;
    if (!payload.clientId || !secrets.refreshToken || !row.remote_id) return;

    const tokenResponse = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: buildOutlookRefreshParams({
        clientId: payload.clientId,
        clientSecret: payload.clientId === builtinClientId ? process.env.MYMAIL_OUTLOOK_CLIENT_SECRET : undefined,
        refreshToken: secrets.refreshToken,
        scopes: shouldUseOutlookRefreshScopes({
          payloadClientId: payload.clientId,
          builtinClientId,
          payloadScopes: payload.scopes,
        }) ? payload.scopes : undefined,
      }),
    });
    if (!tokenResponse.ok) return;

    const token = (await tokenResponse.json()) as OAuthTokenResponse;
    const messagePath = row.remote_folder
      ? `mailFolders/${encodeURIComponent(row.remote_folder)}/messages/${encodeURIComponent(row.remote_id)}`
      : `messages/${encodeURIComponent(row.remote_id)}`;
    const messageResponse = await fetch(
      `https://graph.microsoft.com/v1.0/me/${messagePath}?$select=id,subject,bodyPreview,receivedDateTime,from,isRead,hasAttachments,body`,
      {
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          Prefer: 'outlook.body-content-type="html"',
        },
      },
    );
    if (!messageResponse.ok) return;

    const message = (await messageResponse.json()) as OutlookMessageItem;
    const attachmentResponse = message.hasAttachments
      ? await fetch(
          `https://graph.microsoft.com/v1.0/me/${messagePath}/attachments?$select=id,name,size`,
          { headers: { Authorization: `Bearer ${token.access_token}` } },
        )
      : null;
    const attachmentPayload = attachmentResponse?.ok ? (await attachmentResponse.json()) as OutlookAttachmentResponse : null;
    const attachments = buildAttachmentList(messageId, attachmentPayload?.value ?? []);
    const fromName = message.from?.emailAddress?.name;
    const fromAddress = message.from?.emailAddress?.address;
    const from = fromName && fromAddress ? `"${fromName}" <${fromAddress}>` : fromAddress || fromName;
    const subject = message.subject || row.subject || "(无主题)";
    const text = message.bodyPreview || subject;
    const html = message.body?.contentType === "html" && message.body.content
      ? message.body.content
      : buildFallbackHtml(text, subject);

    updateMessageDetail(messageId, {
      from,
      subject,
      preview: (message.bodyPreview || subject).replace(/\s+/g, " ").trim().slice(0, 140),
      receivedAt: message.receivedDateTime ? new Date(message.receivedDateTime).toISOString() : undefined,
      unread: !message.isRead,
      hasAttachments: Boolean(message.hasAttachments || attachments.length),
      attachments,
      text,
      html,
    });
  }
}
