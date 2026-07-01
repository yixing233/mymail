"use client";

import { FormEvent, useMemo, useState } from "react";

interface IconCandidate {
  url: string;
  rel: string;
  sizes?: string;
  type?: string;
  source: "html" | "manifest" | "fallback";
}

interface ExtractResponse {
  origin: string;
  icons: IconCandidate[];
}

const quickTargets = [
  { label: "Gmail", url: "https://mail.google.com" },
  { label: "Outlook", url: "https://outlook.live.com" },
  { label: "QQ Mail", url: "https://mail.qq.com" },
  { label: "163 Mail", url: "https://mail.163.com" },
];

function iconScore(icon: IconCandidate) {
  const sizeMatch = icon.sizes?.match(/(\d+)\s*x\s*(\d+)/i);
  const size = sizeMatch ? Number(sizeMatch[1]) * Number(sizeMatch[2]) : 0;
  const sourceScore = icon.source === "manifest" ? 3 : icon.source === "html" ? 2 : 1;
  const typeScore = icon.type?.includes("svg") || icon.url.endsWith(".svg") ? 50000 : 0;
  return sourceScore * 100000 + typeScore + size;
}

function sourceLabel(source: IconCandidate["source"]) {
  if (source === "manifest") return "Manifest";
  if (source === "html") return "HTML";
  return "Fallback";
}

export default function IconLabPage() {
  const [url, setUrl] = useState("https://mail.google.com");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ExtractResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  const sortedIcons = useMemo(
    () => [...(result?.icons ?? [])].sort((a, b) => iconScore(b) - iconScore(a)),
    [result],
  );

  async function extract(targetUrl = url) {
    setLoading(true);
    setError(null);
    setCopiedUrl(null);
    setUrl(targetUrl);

    try {
      const response = await fetch("/api/icon-extractor", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: targetUrl }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "提取失败");
      }
      setResult(payload as ExtractResponse);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : "提取失败");
    } finally {
      setLoading(false);
    }
  }

  async function copyIconUrl(iconUrl: string) {
    await navigator.clipboard.writeText(iconUrl);
    setCopiedUrl(iconUrl);
    window.setTimeout(() => setCopiedUrl(null), 1800);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void extract();
  }

  return (
    <main className="min-h-[100dvh] px-4 py-6 text-slate-950 md:px-8">
      <section className="mx-auto grid max-w-6xl gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="rounded-[15px] border border-slate-200/70 bg-white/78 p-4 shadow-[0_20px_40px_rgba(15,23,42,0.08)] backdrop-blur-md">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Icon Lab</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">网站图标提取</h1>
          </div>

          <form onSubmit={handleSubmit} className="mt-5 space-y-3">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-700">网站地址</span>
              <input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://mail.example.com"
                className="w-full rounded-[15px] border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-slate-400"
              />
            </label>
            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-[15px] bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-900 active:translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <i className={`fa-solid ${loading ? "fa-circle-notch fa-spin" : "fa-magnifying-glass"}`} aria-hidden="true" />
              <span>{loading ? "提取中..." : "提取图标"}</span>
            </button>
          </form>

          <div className="mt-5 grid grid-cols-2 gap-2">
            {quickTargets.map((target) => (
              <button
                key={target.url}
                type="button"
                onClick={() => void extract(target.url)}
                disabled={loading}
                className="rounded-[13px] border border-slate-200 bg-white/75 px-3 py-2 text-left text-xs font-semibold text-slate-700 transition hover:bg-slate-50 active:translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {target.label}
              </button>
            ))}
          </div>

          {error ? (
            <div className="mt-5 rounded-[13px] border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-600">
              {error}
            </div>
          ) : null}
        </aside>

        <section className="min-h-[520px] rounded-[15px] border border-slate-200/70 bg-white/78 shadow-[0_20px_40px_rgba(15,23,42,0.08)] backdrop-blur-md">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200/70 px-4 py-3">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-slate-900">提取结果</h2>
              <p className="mt-0.5 truncate text-xs text-slate-400">
                {result ? `${result.origin} · ${sortedIcons.length} 个候选图标` : "等待输入网站地址"}
              </p>
            </div>
            {result ? (
              <a
                href={result.origin}
                target="_blank"
                rel="noreferrer"
                className="grid h-8 w-8 place-items-center rounded-[12px] text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                aria-label="打开网站"
              >
                <i className="fa-solid fa-arrow-up-right-from-square text-xs" aria-hidden="true" />
              </a>
            ) : null}
          </div>

          {loading ? (
            <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="h-44 animate-pulse rounded-[15px] border border-slate-200 bg-slate-50" />
              ))}
            </div>
          ) : sortedIcons.length ? (
            <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
              {sortedIcons.map((icon) => (
                <article key={icon.url} className="overflow-hidden rounded-[15px] border border-slate-200 bg-white">
                  <div className="grid h-28 place-items-center bg-slate-50">
                    <img src={icon.url} alt="" className="max-h-16 max-w-16 object-contain" />
                  </div>
                  <div className="space-y-3 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                        {sourceLabel(icon.source)}
                      </span>
                      <span className="truncate text-[11px] font-medium text-slate-400">
                        {icon.sizes || icon.type || icon.rel}
                      </span>
                    </div>
                    <p className="line-clamp-2 min-h-9 break-all text-xs text-slate-500">{icon.url}</p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => void copyIconUrl(icon.url)}
                        className="rounded-[12px] border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 active:translate-y-[1px]"
                      >
                        {copiedUrl === icon.url ? "已复制" : "复制 URL"}
                      </button>
                      <a
                        href={icon.url}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-[12px] bg-slate-950 px-3 py-2 text-center text-xs font-semibold text-white transition hover:bg-slate-900 active:translate-y-[1px]"
                      >
                        打开
                      </a>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="grid min-h-[440px] place-items-center px-6 text-center">
              <div>
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-[15px] bg-slate-100 text-slate-500">
                  <i className="fa-solid fa-image text-lg" aria-hidden="true" />
                </div>
                <p className="mt-3 text-sm font-semibold text-slate-700">还没有图标</p>
                <p className="mt-1 text-xs text-slate-400">输入网站地址，或点左侧邮箱快捷入口。</p>
              </div>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
