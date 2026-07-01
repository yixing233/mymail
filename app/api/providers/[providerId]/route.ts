import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSingleSyncFetchLimit } from "@/lib/app-settings";
import { openUrlInChrome } from "@/lib/chrome";
import { buildOAuthRedirectUrl } from "@/lib/oauth";
import {
  getProviderFormState,
  getProviderPayload,
  getProviderTokens,
  clearMailboxMessages,
  deleteMailboxConfig,
  saveImapConfig,
  saveOAuthConfig,
} from "@/lib/provider-store";
import { refreshProvider, verifyImapOnSave } from "@/lib/provider-sync";
import { syncProviderMailboxes } from "@/lib/sync-runner";
import type { ProviderId } from "@/lib/types";

const providerSchema = z.object({
  action: z.enum(["refresh", "clear", "retry", "disconnect", "reconnect"]),
});

const oauthConfigSchema = z.object({
  mode: z.literal("oauth"),
  account: z.string().email("请输入有效邮箱"),
  tenantId: z.string().optional(),
  imapHost: z.string().optional(),
  imapPort: z.coerce.number().int().positive().optional(),
  syncFetchLimit: z.coerce.number().int().min(1).max(200).optional(),
});

const imapConfigSchema = z.object({
  mode: z.literal("imap"),
  account: z.string().email("请输入有效邮箱"),
  authorizationCode: z.string().optional(),
  imapHost: z.string().min(1, "缺少 IMAP Host"),
  imapPort: z.coerce.number().int().positive(),
  syncFetchLimit: z.coerce.number().int().min(1).max(200).optional(),
});

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ providerId: string }> },
) {
  const { providerId } = await context.params;
  const mailboxId = request.nextUrl.searchParams.get("mailboxId") || undefined;
  const includeTokens = request.nextUrl.searchParams.get("tokens") === "1";

  try {
    if (includeTokens) {
      if (!mailboxId) {
        return NextResponse.json({ error: "缺少 mailboxId" }, { status: 400 });
      }
      return NextResponse.json({ tokens: getProviderTokens(providerId as ProviderId, mailboxId) });
    }
    return NextResponse.json(getProviderFormState(providerId as ProviderId, mailboxId));
  } catch {
    return NextResponse.json({ error: "Provider not found" }, { status: 404 });
  }
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ providerId: string }> },
) {
  const { providerId } = await context.params;
  const body = await request.json();

  const parsed =
    body.mode === "oauth"
      ? oauthConfigSchema.safeParse(body)
      : imapConfigSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid provider config", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  if (parsed.data.mode === "oauth") {
    const mailboxId = saveOAuthConfig({
      providerId: providerId as ProviderId,
      mailboxId: body.mailboxId,
      account: parsed.data.account,
      tenantId: parsed.data.tenantId,
      imapHost: parsed.data.imapHost,
      imapPort: parsed.data.imapPort,
      syncFetchLimit: parsed.data.syncFetchLimit,
    });
    return NextResponse.json(getProviderFormState(providerId as ProviderId, mailboxId));
  } else {
    const mailboxId = saveImapConfig({
      providerId: providerId as ProviderId,
      mailboxId: body.mailboxId,
      account: parsed.data.account,
      authorizationCode: parsed.data.authorizationCode,
      imapHost: parsed.data.imapHost,
      imapPort: parsed.data.imapPort,
      syncFetchLimit: parsed.data.syncFetchLimit,
    });
    try {
      await verifyImapOnSave(providerId as ProviderId, mailboxId);
    } catch (error) {
      return NextResponse.json(
        {
          error: error instanceof Error ? error.message : "IMAP 连接失败",
          provider: getProviderFormState(providerId as ProviderId, mailboxId),
        },
        { status: 400 },
      );
    }
    return NextResponse.json(getProviderFormState(providerId as ProviderId, mailboxId));
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ providerId: string }> },
) {
  const { providerId } = await context.params;
  const mailboxId = request.nextUrl.searchParams.get("mailboxId") || undefined;
  const chromeProfile = request.nextUrl.searchParams.get("chromeProfile") || undefined;

  if (!mailboxId) {
    return NextResponse.json({ error: "缺少 mailboxId" }, { status: 400 });
  }

  const provider = getProviderFormState(providerId as ProviderId, mailboxId);

  if (provider.mode !== "oauth") {
    return NextResponse.json({ error: "OAuth only" }, { status: 400 });
  }

  if (!provider.mailboxId) {
    return NextResponse.json({ error: "请先保存邮箱配置" }, { status: 400 });
  }

  const origin = request.nextUrl.origin;
  const payload = getProviderPayload(providerId as ProviderId, provider.mailboxId);

  if (!payload.clientId) {
    return NextResponse.json({ error: "请先保存客户端配置" }, { status: 400 });
  }

  const authorizeUrl = buildOAuthRedirectUrl(providerId as ProviderId, origin, provider.mailboxId);

  if (providerId === "gmail") {
    const chromeResult = openUrlInChrome(authorizeUrl, { profileDirectory: chromeProfile });
    return NextResponse.json({
      authorizeUrl,
      openedInChrome: chromeResult.opened,
      chromeError: chromeResult.error,
    });
  }

  return NextResponse.json({ authorizeUrl, openedInChrome: false });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ providerId: string }> },
) {
  const { providerId } = await context.params;
  const body = await request.json();
  const mailboxId = typeof body?.mailboxId === "string" ? body.mailboxId : undefined;
  const provider = getProviderFormState(providerId as ProviderId, mailboxId);

  const parsed = providerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid provider action", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  if (parsed.data.action === "refresh") {
    try {
      if (!mailboxId) {
        const result = await syncProviderMailboxes(providerId as ProviderId);
        return NextResponse.json({
          provider: getProviderFormState(providerId as ProviderId),
          ...result,
        });
      }

      const result = await refreshProvider(providerId as ProviderId, mailboxId, {
        limit: provider.syncFetchLimit ?? getSingleSyncFetchLimit(),
      });
      return NextResponse.json({
        provider: getProviderFormState(providerId as ProviderId, mailboxId),
        result,
      });
    } catch (error) {
      return NextResponse.json(
        {
          error: error instanceof Error ? error.message : "刷新失败",
          provider,
        },
        { status: 400 },
      );
    }
  }

  if (parsed.data.action === "clear") {
    if (!mailboxId) {
      return NextResponse.json({ error: "缺少 mailboxId" }, { status: 400 });
    }

    try {
      clearMailboxMessages(providerId as ProviderId, mailboxId);
      return NextResponse.json({
        provider: getProviderFormState(providerId as ProviderId, mailboxId),
        success: true,
      });
    } catch (error) {
      return NextResponse.json(
        {
          error: error instanceof Error ? error.message : "清空失败",
          provider,
        },
        { status: 400 },
      );
    }
  }

  return NextResponse.json({
    providerId,
    action: parsed.data.action,
    status: "queued",
    confirmationRequired: parsed.data.action === "disconnect",
  });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ providerId: string }> },
) {
  const { providerId } = await context.params;
  const mailboxId = request.nextUrl.searchParams.get("mailboxId") || undefined;

  if (!mailboxId) {
    return NextResponse.json({ error: "缺少 mailboxId" }, { status: 400 });
  }

  try {
    deleteMailboxConfig(providerId as ProviderId, mailboxId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "删除失败" },
      { status: 404 },
    );
  }
}
