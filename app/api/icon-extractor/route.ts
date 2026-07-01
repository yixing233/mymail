import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

interface IconCandidate {
  url: string;
  rel: string;
  sizes?: string;
  type?: string;
  source: "html" | "manifest" | "fallback";
}

const requestSchema = z.object({
  url: z.string().url(),
});

function parseAttributes(tag: string) {
  const attrs = new Map<string, string>();
  const attrPattern = /([^\s"'=<>`]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  for (const match of tag.matchAll(attrPattern)) {
    attrs.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attrs;
}

function resolveIconUrl(value: string, baseUrl: string) {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function uniqueIcons(icons: IconCandidate[]) {
  const seen = new Set<string>();
  return icons.filter((icon) => {
    if (seen.has(icon.url)) return false;
    seen.add(icon.url);
    return true;
  });
}

async function fetchText(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "MyMail Icon Extractor",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`请求失败：${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function readManifestIcons(manifestUrl: string, baseUrl: string): Promise<IconCandidate[]> {
  try {
    const text = await fetchText(manifestUrl);
    const manifest = JSON.parse(text) as { icons?: Array<{ src?: string; sizes?: string; type?: string }> };
    const icons: IconCandidate[] = [];
    for (const icon of manifest.icons ?? []) {
      const url = icon.src ? resolveIconUrl(icon.src, baseUrl) : undefined;
      if (!url) continue;
      icons.push({
        url,
        rel: "manifest icon",
        sizes: icon.sizes,
        type: icon.type,
        source: "manifest",
      });
    }
    return icons;
  } catch {
    return [];
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "请输入有效 URL" }, { status: 400 });
  }

  try {
    const target = new URL(parsed.data.url);
    const html = await fetchText(target.toString());
    const icons: IconCandidate[] = [];
    const manifests: string[] = [];

    for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
      const attrs = parseAttributes(match[0]);
      const rel = attrs.get("rel")?.toLowerCase() ?? "";
      const href = attrs.get("href");
      if (!href) continue;

      if (rel.split(/\s+/).includes("manifest")) {
        const manifestUrl = resolveIconUrl(href, target.toString());
        if (manifestUrl) manifests.push(manifestUrl);
        continue;
      }

      if (!rel.includes("icon")) continue;
      const url = resolveIconUrl(href, target.toString());
      if (!url) continue;

      icons.push({
        url,
        rel,
        sizes: attrs.get("sizes"),
        type: attrs.get("type"),
        source: "html",
      });
    }

    for (const manifestUrl of manifests.slice(0, 2)) {
      icons.push(...await readManifestIcons(manifestUrl, target.toString()));
    }

    for (const path of ["/favicon.ico", "/favicon.svg", "/apple-touch-icon.png"]) {
      icons.push({
        url: new URL(path, target.origin).toString(),
        rel: path.replace("/", ""),
        source: "fallback",
      });
    }

    return NextResponse.json({
      origin: target.origin,
      icons: uniqueIcons(icons),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "提取图标失败" },
      { status: 400 },
    );
  }
}
