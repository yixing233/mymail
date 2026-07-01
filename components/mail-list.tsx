"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import clsx from "clsx";
import { formatTime } from "@/lib/utils";
import { useContextMenu } from "@/components/context-menu";
import { useToast } from "@/components/toast";
import type { MailMessage } from "@/lib/types";

function getProviderIcon(providerId: string) {
  switch (providerId) {
    case "gmail":
      return "fa-brands fa-google";
    case "outlook":
      return "fa-brands fa-microsoft";
    case "qq":
      return "fa-brands fa-qq";
    case "mail163":
      return "fa-solid fa-envelope";
    default:
      return "fa-solid fa-envelope";
  }
}

function getProviderColor(providerId: string) {
  switch (providerId) {
    case "gmail":
      return "#ef4444";
    case "outlook":
      return "#2563eb";
    case "qq":
      return "#0ea5e9";
    case "mail163":
      return "#f97316";
    default:
      return "#64748b";
  }
}

export function MailList({
  messages,
  viewKey,
  onSelectMessage,
}: {
  messages: MailMessage[];
  viewKey: string;
  onSelectMessage?: (messageId: string) => void;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const selectedId = params.get("message");
  const [optimisticSelectedId, setOptimisticSelectedId] = useState<string | null>(null);
  const activeSelectedId = optimisticSelectedId ?? selectedId ?? messages[0]?.id;

  const { showMenu } = useContextMenu();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setOptimisticSelectedId(null);
  }, [selectedId, messages]);

  async function handleMailAction(messageId: string, action: "read" | "unread" | "delete") {
    try {
      const response = await fetch(`/api/messages/${encodeURIComponent(messageId)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action }),
      });

      if (!response.ok) throw new Error("操作失败");

      const actionText = action === "read" ? "已标为已读" : action === "unread" ? "已标为未读" : "邮件已删除";
      toast.success(actionText);

      startTransition(() => {
        const searchParams = new URLSearchParams(window.location.search);
        if (action === "delete" && searchParams.get("message") === messageId) {
          searchParams.delete("message");
          router.push(`/?${searchParams.toString()}`);
        } else {
          router.refresh();
        }
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
    }
  }

  const handleCopySender = (sender: string) => {
    navigator.clipboard.writeText(sender);
    toast.success("已复制发件人地址");
  };

  function openMessage(messageId: string) {
    const next = new URLSearchParams(params.toString());
    next.set("message", messageId);
    setOptimisticSelectedId(messageId);
    onSelectMessage?.(messageId);
    startTransition(() => {
      router.push(`/?${next.toString()}`);
    });
  }

  return (
    <div
      key={viewKey}
      className={`content-swap scrollbar-thin flex h-full min-h-0 flex-col gap-2 overflow-y-auto pr-2 ${isPending ? "opacity-90" : ""}`}
    >
      {messages.length ? (
        messages.map((message) => (
          <button
            type="button"
            key={message.id}
            onClick={() => openMessage(message.id)}
            onContextMenu={(e) => {
              e.stopPropagation();
              showMenu(e, [
                {
                  label: message.unread ? "标记为已读" : "标记为未读",
                  icon: message.unread ? "fa-solid fa-envelope-open" : "fa-solid fa-envelope",
                  onClick: () => handleMailAction(message.id, message.unread ? "read" : "unread"),
                },
                {
                  label: "复制发件人",
                  icon: "fa-solid fa-copy",
                  onClick: () => handleCopySender(message.from),
                },
                {
                  label: "删除邮件",
                  icon: "fa-solid fa-trash-can",
                  danger: true,
                  onClick: () => handleMailAction(message.id, "delete"),
                },
              ]);
            }}
            className={clsx(
              "rounded-[15px] border px-4 py-4 text-left transition",
              activeSelectedId === message.id
                ? "border-sky-500 bg-white text-slate-900 ring-2 ring-sky-100"
                : "border-slate-200/70 bg-white/80 text-slate-900 hover:border-slate-300 hover:bg-white",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold">{message.from}</span>
                  {message.unread ? (
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-sky-500" aria-label="未读" />
                  ) : null}
                </div>
                <p className="mt-2 truncate text-base font-semibold">{message.subject}</p>
                <p
                  className={clsx(
                    "mt-1 truncate text-sm",
                    "text-slate-500",
                  )}
                >
                  {message.preview}
                </p>
              </div>
              <div className="flex shrink-0 min-w-[72px] flex-col items-end justify-between text-right">
                <p className="text-xs font-semibold text-slate-400">
                  {formatTime(message.receivedAt)}
                </p>
                <div className="mt-4 flex flex-col items-end gap-2">
                  {message.hasAttachments ? (
                    <p className="text-xs font-semibold">附件</p>
                  ) : null}
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                    <i
                      className={`${getProviderIcon(message.providerId)} text-[9px]`}
                      style={{ color: getProviderColor(message.providerId) }}
                      aria-hidden="true"
                    />
                    <span>{message.providerLabel}</span>
                  </span>
                </div>
              </div>
            </div>
          </button>
        ))
      ) : (
        <div className="flex min-h-full items-center justify-center rounded-[15px] border border-slate-200/70 bg-white/70 px-6 text-center">
          <div>
            <p className="text-lg font-semibold text-slate-900">暂无邮件</p>
            <p className="mt-2 text-sm text-slate-500">先绑定邮箱，再开始接收新邮件。</p>
          </div>
        </div>
      )}
    </div>
  );
}
