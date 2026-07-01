"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MailDetail } from "@/components/mail-detail";
import { MailList } from "@/components/mail-list";
import { SyncActions } from "@/components/sync-actions";
import type { MailDetail as MailDetailType, MailMessage, ProviderId } from "@/lib/types";

export function needsMessageHydration(message?: Pick<MailDetailType, "preview" | "text" | "html" | "subject">) {
  if (!message) {
    return false;
  }

  const text = message.text.trim();
  const html = message.html.trim();
  const preview = message.preview.trim();
  const fallbackText = preview || message.subject;
  const hasStructuredHtml = /<(?:!doctype|html|body|table|div|p|img|section|article)\b/i.test(html);
  const hasOnlySummaryText = !text || text === preview;
  const hasOnlyFallbackHtml =
    !html ||
    html === `<div>${fallbackText}</div>` ||
    html.includes(`<p>${fallbackText}</p>`);

  if (hasStructuredHtml && !hasOnlyFallbackHtml) {
    return false;
  }

  return hasOnlySummaryText || hasOnlyFallbackHtml;
}

export function shouldShowDetailLoading(
  pendingMessageId: string | null,
  currentMessageId?: string,
  hydratingMessageId?: string | null,
) {
  return Boolean(
    (pendingMessageId && pendingMessageId !== currentMessageId) ||
    (hydratingMessageId && hydratingMessageId === currentMessageId),
  );
}

export function getHydratingMessageIdAfterHydration(
  hydratingMessageId: string | null,
  _hydrated: boolean,
) {
  return hydratingMessageId ? null : null;
}

export async function maybeHydrateSelectedMessage(message?: MailDetailType) {
  if (!message || !needsMessageHydration(message)) {
    return false;
  }

  const response = await fetch(`/api/messages/${encodeURIComponent(message.id)}/hydrate`, {
    method: "POST",
  });

  return response.ok;
}

export function MailWorkbench({
  messages,
  selectedMessage,
  viewKey,
  source,
  mailboxId,
  label,
}: {
  messages: MailMessage[];
  selectedMessage?: MailDetailType;
  viewKey: string;
  source: ProviderId | "all";
  mailboxId?: string;
  label: string;
}) {
  const router = useRouter();
  const [pendingMessageId, setPendingMessageId] = useState<string | null>(null);
  const [hydratingMessageId, setHydratingMessageId] = useState<string | null>(null);
  const isDetailLoading = shouldShowDetailLoading(pendingMessageId, selectedMessage?.id, hydratingMessageId);

  useEffect(() => {
    if (!pendingMessageId || selectedMessage?.id === pendingMessageId) {
      setPendingMessageId(null);
    }
  }, [pendingMessageId, selectedMessage?.id]);

  useEffect(() => {
    setPendingMessageId(null);
  }, [viewKey]);

  useEffect(() => {
    if (!selectedMessage) {
      setHydratingMessageId(null);
      return;
    }

    if (!needsMessageHydration(selectedMessage)) {
      setHydratingMessageId(null);
      return;
    }

    let cancelled = false;
    setHydratingMessageId(selectedMessage.id);

    void maybeHydrateSelectedMessage(selectedMessage).then((hydrated) => {
      if (cancelled) {
        return;
      }
      setHydratingMessageId((current) => getHydratingMessageIdAfterHydration(current, hydrated));
      if (!hydrated) {
        return;
      }
      router.refresh();
    }).catch(() => {
      if (!cancelled) {
        setHydratingMessageId(null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [router, selectedMessage]);

  return (
    <div className="grid min-h-0 min-w-0 flex-1 lg:grid-cols-[minmax(300px,0.72fr)_minmax(0,1.28fr)]">
      <section className="flex min-h-0 min-w-0 flex-col overflow-hidden p-4 md:p-5">
        <SyncActions source={source} mailboxId={mailboxId} label={label} totalMessages={messages.length} />

        <div className="mt-2 min-h-0 flex-1">
          <MailList messages={messages} viewKey={viewKey} onSelectMessage={setPendingMessageId} />
        </div>
      </section>

      <MailDetail message={selectedMessage} viewKey={viewKey} loading={isDetailLoading} />
    </div>
  );
}
