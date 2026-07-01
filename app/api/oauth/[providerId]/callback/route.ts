import { NextRequest, NextResponse } from "next/server";
import { exchangeOAuthCode, parseOAuthState } from "@/lib/oauth";
import type { ProviderId } from "@/lib/types";

function oauthCloseResponse(input: {
  providerId: string;
  status: "success" | "error";
  message?: string;
}) {
  const payload = JSON.stringify({
    providerId: input.providerId,
    status: input.status,
    message: input.message,
    at: Date.now(),
  }).replace(/</g, "\\u003c");

  const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>OAuth callback</title>
  </head>
  <body>
    <script>
      const payload = ${payload};
      try {
        localStorage.setItem("mymail:oauth-result", JSON.stringify(payload));
      } catch (error) {}

      if (window.opener && !window.opener.closed) {
        try {
          window.opener.postMessage({ type: "mymail:oauth-result", payload }, window.location.origin);
        } catch (error) {}
      }

      window.close();
      window.setTimeout(() => {
        window.location.replace("/?oauth=" + encodeURIComponent(payload.providerId) + "&" + (payload.status === "success" ? "success=1" : "error=" + encodeURIComponent(payload.message || "oauth_failed")));
      }, 800);
    </script>
  </body>
</html>`;

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ providerId: string }> },
) {
  const { providerId } = await context.params;
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const error = request.nextUrl.searchParams.get("error");

  if (error) {
    return oauthCloseResponse({ providerId, status: "error", message: error });
  }

  if (!code || !state) {
    return oauthCloseResponse({ providerId, status: "error", message: "missing_code" });
  }

  try {
    const parsed = parseOAuthState(state);
    if (parsed.providerId !== providerId) {
      return oauthCloseResponse({ providerId, status: "error", message: "state_mismatch" });
    }

    await exchangeOAuthCode({
      providerId: providerId as ProviderId,
      mailboxId: parsed.mailboxId,
      code,
      origin: request.nextUrl.origin,
    });

    return oauthCloseResponse({ providerId, status: "success" });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "oauth_failed";
    return oauthCloseResponse({ providerId, status: "error", message });
  }
}
