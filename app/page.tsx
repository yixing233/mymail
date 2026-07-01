import { Suspense } from "react";
import { MailWorkbench } from "@/components/mail-workbench";
import { ProvidersPanel } from "@/components/providers-panel";
import { RunLogsPage } from "@/components/run-logs-page";
import { Toolbar } from "@/components/toolbar";
import { WorkbenchViewSwitch } from "@/components/workbench-view-switch";
import { queryInbox } from "@/lib/inbox";
import type { MailFilter, ProviderId } from "@/lib/types";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolved = await searchParams;
  const source = (resolved.source as ProviderId | "all" | undefined) ?? "all";
  const mailboxId = source === "all" ? undefined : resolved.mailbox as string | undefined;
  const filter = (resolved.filter as MailFilter | undefined) ?? "all";
  const selectedId = resolved.message as string | undefined;
  const search = resolved.search as string | undefined;
  const showLogs = resolved.view === "logs";
  const inbox = await queryInbox({ source, mailboxId, filter, selectedId, search });
  const viewKey = `${source}:${mailboxId ?? "all"}:${filter}:${search ?? ""}`;
  const mailboxTitle =
    source === "all"
      ? "全部邮箱"
      : mailboxId
        ? inbox.providers
            .find((provider) => provider.id === source)
            ?.mailboxes.find((mailbox) => mailbox.id === mailboxId)?.account ||
          inbox.providers.find((provider) => provider.id === source)?.label ||
          "全部邮箱"
        : inbox.providers.find((provider) => provider.id === source)?.label || "全部邮箱";
  const title = showLogs ? "运行日志" : mailboxTitle;

  return (
    <main className="h-[100dvh] overflow-hidden">
      <section className="mx-auto grid h-[100dvh] max-w-[1600px] overflow-hidden rounded-[15px] border border-slate-200/70 bg-white/75 shadow-[0_20px_40px_rgba(15,23,42,0.08)] lg:grid-cols-[300px_minmax(300px,0.72fr)_minmax(0,1.28fr)]">
        <Suspense fallback={<div className="min-h-0" />}>
          <ProvidersPanel providers={inbox.providers} />
        </Suspense>

        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden border-t border-slate-200/70 max-md:pb-24 md:border-l md:border-t-0 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/70 px-4 pb-4 pt-4 md:px-5 md:pt-5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-2xl font-semibold tracking-tight" title={title}>
                {title}
              </div>
              {showLogs ? (
                <p className="mt-1 truncate text-xs font-medium text-slate-500">
                  邮箱刷新、授权校验和同步结果
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              <Suspense fallback={<div className="h-8 w-44 rounded-[12px] bg-white/60" />}>
                <WorkbenchViewSwitch />
              </Suspense>
              {!showLogs ? (
                <Suspense fallback={<div className="h-8 w-44 rounded-[12px] bg-white/60" />}>
                  <Toolbar />
                </Suspense>
              ) : null}
            </div>
          </div>

          {showLogs ? (
            <div className="content-swap min-h-0 min-w-0 flex-1 overflow-hidden">
              <RunLogsPage embedded />
            </div>
          ) : (
            <Suspense fallback={<div className="h-full min-h-0" />}>
              <MailWorkbench
                messages={inbox.messages}
                selectedMessage={inbox.selectedMessage}
                viewKey={viewKey}
                source={source}
                mailboxId={mailboxId}
                label={mailboxTitle}
              />
            </Suspense>
          )}
        </section>
      </section>
    </main>
  );
}
