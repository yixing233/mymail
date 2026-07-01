import { NextRequest, NextResponse } from "next/server";
import { gmailIconSvg, outlookIconSvg } from "@/app/api/notification-icon/assets";
import type { ProviderId } from "@/lib/types";

const remoteIconUrls: Partial<Record<ProviderId, string>> = {
  qq: "https://res.wx.qq.com/t/webmail/webmail/res/static/images/base/style/favicon/qqmail_favicon_96h.8d124a7.png",
  mail163: "https://mail.163.com/favicon.ico",
};

async function proxyRemoteIcon(url: string) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "MyMail Notification Icon",
    },
    next: { revalidate: 86400 },
  });
  if (!response.ok) {
    throw new Error(`Icon fetch failed: ${response.status}`);
  }

  return new NextResponse(await response.arrayBuffer(), {
    headers: {
      "Content-Type": response.headers.get("content-type") ?? "image/png",
      "Cache-Control": "public, max-age=86400, immutable",
    },
  });
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ providerId: string }> },
) {
  const { providerId } = await context.params;

  if (providerId === "gmail") {
    return new NextResponse(gmailIconSvg, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  }

  if (providerId === "outlook") {
    return new NextResponse(outlookIconSvg, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  }

  const remoteIconUrl = remoteIconUrls[providerId as ProviderId];
  if (remoteIconUrl) {
    try {
      return await proxyRemoteIcon(remoteIconUrl);
    } catch {
      return NextResponse.redirect(remoteIconUrl, 302);
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="28" fill="#0f172a"/><text x="64" y="74" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="58" font-weight="700" fill="#ffffff">M</text></svg>`;

  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=86400, immutable",
    },
  });
}
