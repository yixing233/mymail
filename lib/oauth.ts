import crypto from "node:crypto";
import { providerScopes } from "@/lib/data";
import { getProviderPayload, getProviderSecrets, updateProviderConnectionState } from "@/lib/provider-store";
import type { ProviderId } from "@/lib/types";

function getSecret() {
  const value = process.env.MYMAIL_SECRET?.trim();
  return value || "dev-only-secret-change-me";
}

function encodeState(payload: object) {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", getSecret()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function decodeState<T>(value: string): T {
  const [body, signature] = value.split(".");
  const expected = crypto.createHmac("sha256", getSecret()).update(body).digest("base64url");
  if (signature !== expected) {
    throw new Error("State signature mismatch");
  }
  return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
}

export function buildOAuthState(providerId: ProviderId, returnTo: string) {
  return encodeState({
    providerId,
    returnTo,
    createdAt: Date.now(),
  });
}

export function parseOAuthState(value: string) {
  return decodeState<{ providerId: ProviderId; returnTo: string; createdAt: number; mailboxId?: string }>(value);
}

export function buildOAuthRedirectUrl(providerId: ProviderId, origin: string, mailboxId?: string) {
  if (!mailboxId) {
    throw new Error("OAuth mailboxId is required");
  }

  const payload = getProviderPayload(providerId, mailboxId);
  const callbackUrl = `${origin}/api/oauth/${providerId}/callback`;
  const state = encodeState({
    providerId,
    returnTo: "/",
    createdAt: Date.now(),
    mailboxId,
  });

  if (!payload.clientId) {
    throw new Error("请先保存客户端 ID");
  }

  if (providerId === "gmail") {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", payload.clientId);
    url.searchParams.set("redirect_uri", callbackUrl);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", providerScopes.gmail.join(" "));
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("include_granted_scopes", "true");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", state);
    return url.toString();
  }

  if (providerId === "outlook") {
    const tenantId = payload.tenantId || "common";
    const url = new URL(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`);
    url.searchParams.set("client_id", payload.clientId);
    url.searchParams.set("redirect_uri", callbackUrl);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", providerScopes.outlook.join(" "));
    url.searchParams.set("response_mode", "query");
    url.searchParams.set("state", state);
    return url.toString();
  }

  throw new Error("Only OAuth providers supported");
}

export async function exchangeOAuthCode(input: {
  providerId: ProviderId;
  mailboxId?: string;
  code: string;
  origin: string;
}) {
  if (!input.mailboxId) {
    throw new Error("OAuth mailboxId is required");
  }

  const payload = getProviderPayload(input.providerId, input.mailboxId);
  const secrets = getProviderSecrets(input.providerId, input.mailboxId);
  const callbackUrl = `${input.origin}/api/oauth/${input.providerId}/callback`;

  if (!payload.clientId || !secrets.clientSecret) {
    throw new Error("OAuth client is incomplete");
  }

  if (input.providerId === "gmail") {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: payload.clientId,
        client_secret: secrets.clientSecret,
        code: input.code,
        grant_type: "authorization_code",
        redirect_uri: callbackUrl,
      }),
    });

    if (!response.ok) {
      throw new Error("Google token exchange failed");
    }

    const tokens = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      token_type: string;
    };

    const profileResponse = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
      },
    });

    if (!profileResponse.ok) {
      throw new Error("Google account verify failed");
    }

    const profile = (await profileResponse.json()) as { emailAddress: string };

    updateProviderConnectionState({
      providerId: "gmail",
      mailboxId: input.mailboxId,
      account: profile.emailAddress,
      status: "connected",
      health: "healthy",
      lastSyncedAt: new Date().toISOString(),
      lastError: null,
      tokenPayload: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenType: tokens.token_type,
        expiryDate: Date.now() + tokens.expires_in * 1000,
      },
    });
    return;
  }

  if (input.providerId === "outlook") {
    const tenantId = payload.tenantId || "common";
    const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: payload.clientId,
        client_secret: secrets.clientSecret,
        code: input.code,
        grant_type: "authorization_code",
        redirect_uri: callbackUrl,
        scope: providerScopes.outlook.join(" "),
      }),
    });

    if (!response.ok) {
      throw new Error("Microsoft token exchange failed");
    }

    const tokens = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      token_type: string;
      id_token?: string;
    };

    const profileResponse = await fetch("https://graph.microsoft.com/v1.0/me?$select=userPrincipalName,mail", {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
      },
    });

    if (!profileResponse.ok) {
      throw new Error("Microsoft account verify failed");
    }

    const profile = (await profileResponse.json()) as { userPrincipalName?: string; mail?: string };
    const account = profile.mail || profile.userPrincipalName || "";

    updateProviderConnectionState({
      providerId: "outlook",
      mailboxId: input.mailboxId,
      account,
      status: "connected",
      health: "healthy",
      lastSyncedAt: new Date().toISOString(),
      lastError: null,
      tokenPayload: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenType: tokens.token_type,
        expiryDate: Date.now() + tokens.expires_in * 1000,
      },
    });
    return;
  }

  throw new Error("Unsupported OAuth provider");
}
