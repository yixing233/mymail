"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MailDetail as MailDetailType } from "@/lib/types";
import { extractVerificationCodes } from "@/lib/verification";
import { formatTime } from "@/lib/utils";

export const mailFrameSandbox = "allow-same-origin allow-popups allow-popups-to-escape-sandbox";
export const mailFrameScrolling = "no";

function buildMailDocument(html: string) {
  if (/<(?:!doctype|html)\b/i.test(html)) {
    return html;
  }

  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>${html}</body>
</html>`;
}

function MailDetailSkeleton({ viewKey }: { viewKey: string }) {
  return (
    <section
      key={`loading-${viewKey}`}
      aria-busy="true"
      aria-label="正在加载邮件详情"
      className="content-swap scrollbar-thin flex h-full min-h-0 min-w-0 flex-col overflow-y-auto border-t border-slate-200/70 p-4 lg:border-l lg:border-t-0 md:p-6"
    >
      <div className="min-w-0 border-b border-slate-200/80 pb-5">
        <div className="flex items-center justify-between gap-3">
          <div className="skeleton-shimmer h-7 w-24 rounded-full" />
          <div className="skeleton-shimmer h-8 w-28 rounded-[12px]" />
        </div>
        <div className="skeleton-shimmer mt-5 h-8 w-[76%] rounded-[12px]" />
        <div className="mt-4 flex flex-wrap gap-3">
          <div className="skeleton-shimmer h-5 w-52 rounded-full" />
          <div className="skeleton-shimmer h-5 w-28 rounded-full" />
        </div>
      </div>

      <div className="scrollbar-thin mt-6 min-h-0 min-w-0 flex-1 overflow-hidden pr-1">
        <div className="min-h-[480px] rounded-[18px] border border-slate-200/70 bg-white p-6">
          <div className="skeleton-shimmer h-4 w-[92%] rounded-full" />
          <div className="skeleton-shimmer mt-4 h-4 w-[68%] rounded-full" />
          <div className="skeleton-shimmer mt-8 h-28 w-full rounded-[18px]" />
          <div className="skeleton-shimmer mt-5 h-4 w-[84%] rounded-full" />
          <div className="skeleton-shimmer mt-3 h-4 w-[58%] rounded-full" />
        </div>
        <div className="mt-6 border-t border-slate-200/80 pt-5">
          <div className="skeleton-shimmer h-4 w-20 rounded-full" />
          <div className="skeleton-shimmer mt-3 h-14 w-44 rounded-[15px]" />
        </div>
      </div>
    </section>
  );
}

export function MailDetail({ message, viewKey, loading = false }: { message?: MailDetailType; viewKey: string; loading?: boolean }) {
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [iframeHeight, setIframeHeight] = useState(480);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const iframeDoc = useMemo(() => (message ? buildMailDocument(message.html) : ""), [message]);

  async function copyCode(code: string) {
    await navigator.clipboard.writeText(code);
    setCopiedCode(code);
    window.setTimeout(() => setCopiedCode(null), 1200);
  }

  useEffect(() => {
    setIframeHeight(480);
  }, [iframeDoc]);

  useEffect(() => {
    if (!message) {
      return;
    }

    const iframe = iframeRef.current;
    if (!iframe) {
      return;
    }

    let resizeObserver: ResizeObserver | null = null;
    let settleTimer: number | null = null;

    const syncHeight = () => {
      let doc: Document | null = null;
      try {
        doc = iframe.contentDocument;
      } catch {
        return;
      }
      if (!doc) {
        return;
      }

      const nextHeight = Math.max(
        480,
        doc.documentElement?.scrollHeight ?? 0,
        doc.body?.scrollHeight ?? 0,
      );
      setIframeHeight((current) => (Math.abs(current - nextHeight) > 1 ? nextHeight : current));
    };

    const bindFrameEvents = () => {
      let doc: Document | null = null;
      try {
        doc = iframe.contentDocument;
      } catch {
        return;
      }
      if (!doc) {
        return;
      }

      resizeObserver?.disconnect();
      resizeObserver = null;
      if (settleTimer !== null) {
        window.clearTimeout(settleTimer);
        settleTimer = null;
      }

      syncHeight();
      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(syncHeight);
        resizeObserver.observe(doc.documentElement);
        if (doc.body) {
          resizeObserver.observe(doc.body);
        }
      }
      settleTimer = window.setTimeout(syncHeight, 60);
    };

    const handleLoad = () => {
      bindFrameEvents();
    };

    iframe.addEventListener("load", handleLoad);
    bindFrameEvents();

    return () => {
      iframe.removeEventListener("load", handleLoad);
      resizeObserver?.disconnect();
      if (settleTimer !== null) {
        window.clearTimeout(settleTimer);
      }
    };
  }, [iframeDoc, message]);

  function downloadDebugHtml() {
    if (!message || !iframeDoc) return;

    const blob = new Blob([iframeDoc], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const safeSubject = message.subject.replace(/[\\/:*?"<>|]+/g, "-").slice(0, 40) || "mail";
    anchor.href = url;
    anchor.download = `${safeSubject}-${message.id}.html`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return <MailDetailSkeleton viewKey={viewKey} />;
  }

  if (!message) {
    return (
      <section
        key={viewKey}
        className="content-swap flex h-full min-h-0 min-w-0 items-center justify-center overflow-hidden border-t border-slate-200/70 p-8 text-slate-500 lg:border-l lg:border-t-0"
      >
        暂无邮件详情
      </section>
    );
  }

  const codes = extractVerificationCodes(message.subject, message.preview, message.text, message.from);

  return (
    <section
      key={viewKey}
      className="content-swap scrollbar-thin flex h-full min-h-0 min-w-0 flex-col overflow-y-auto border-t border-slate-200/70 p-4 lg:border-l lg:border-t-0 md:p-6"
    >
      <div className="min-w-0 border-b border-slate-200/80 pb-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-500">
              {message.providerLabel}
            </span>
            {message.hasAttachments ? (
              <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">
                附件 {message.attachments.length}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={downloadDebugHtml}
            className="rounded-[12px] border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            导出最终 HTML
          </button>
        </div>
        <h2 className="mt-4 overflow-wrap-anywhere text-2xl font-semibold tracking-tight">{message.subject}</h2>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-slate-500">
          <span className="min-w-0 overflow-wrap-anywhere">{message.from}</span>
          <span>{formatTime(message.receivedAt)}</span>
        </div>

        {codes.length ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
              验证码
            </span>
            {codes.map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => copyCode(code)}
                className="rounded-[12px] border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-50"
              >
                {copiedCode === code ? "已复制" : code}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="mt-6 min-w-0 pr-1">
        <iframe
          ref={iframeRef}
          title={`邮件正文-${message.id}`}
          srcDoc={iframeDoc}
          sandbox={mailFrameSandbox}
          scrolling={mailFrameScrolling}
          style={{ height: `${iframeHeight}px`, overflow: "hidden" }}
          className="block min-h-[480px] w-full rounded-[18px] border border-slate-200/70 bg-white"
        />

        <div className="mt-6 min-w-0 border-t border-slate-200/80 pt-5">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">附件</p>
          <div className="mt-3 flex flex-wrap gap-3">
            {message.attachments.length ? (
              message.attachments.map((attachment) => (
                <button
                  key={attachment.id}
                  type="button"
                  className="min-w-0 max-w-full rounded-[15px] border border-slate-200 bg-white px-4 py-3 text-left"
                >
                  <p className="overflow-wrap-anywhere text-sm font-semibold text-slate-900">{attachment.name}</p>
                  <p className="text-xs text-slate-500">{attachment.sizeLabel}</p>
                </button>
              ))
            ) : (
              <p className="text-sm text-slate-500">无附件</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
