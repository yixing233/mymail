import { getAutoSyncFetchLimit, getBulkSyncFetchLimit } from "@/lib/app-settings";
import { listProviderConfigs, listProviderMailboxes } from "@/lib/provider-store";
import { refreshProvider } from "@/lib/provider-sync";
import type { ProviderId } from "@/lib/types";

export interface SyncMailboxTarget {
  providerId: ProviderId;
  mailboxId: string;
  account: string;
}

export interface SyncMailboxResult extends SyncMailboxTarget {
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface SyncAllMailboxesResult {
  triggeredAt: string;
  summary: {
    total: number;
    succeeded: number;
    failed: number;
  };
  results: SyncMailboxResult[];
}

type SyncTrigger = "manual" | "auto";

async function syncTargets(targets: SyncMailboxTarget[], trigger: SyncTrigger): Promise<SyncMailboxResult[]> {
  const limit = trigger === "auto" ? getAutoSyncFetchLimit() : getBulkSyncFetchLimit();

  return Promise.all(
    targets.map(async (target) => {
      try {
        const result = await refreshProvider(target.providerId, target.mailboxId, { limit });
        return {
          ...target,
          ok: true,
          result,
        };
      } catch (error) {
        return {
          ...target,
          ok: false,
          error: error instanceof Error ? error.message : "同步失败",
        };
      }
    }),
  );
}

function summarizeResults(results: SyncMailboxResult[]) {
  return {
    total: results.length,
    succeeded: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
  };
}

export async function syncAllMailboxes(options?: { trigger?: SyncTrigger }): Promise<SyncAllMailboxesResult> {
  const targets: SyncMailboxTarget[] = listProviderConfigs().flatMap((provider) =>
    provider.mailboxes.map((mailbox) => ({
      providerId: provider.id,
      mailboxId: mailbox.id,
      account: mailbox.account,
    })),
  );

  const results = await syncTargets(targets, options?.trigger ?? "manual");

  return {
    triggeredAt: new Date().toISOString(),
    summary: summarizeResults(results),
    results,
  };
}

export async function syncProviderMailboxes(providerId: ProviderId): Promise<SyncAllMailboxesResult> {
  const targets: SyncMailboxTarget[] = listProviderMailboxes(providerId).map((mailbox) => ({
    providerId,
    mailboxId: mailbox.id,
    account: mailbox.account,
  }));

  const results = await syncTargets(targets, "manual");

  return {
    triggeredAt: new Date().toISOString(),
    summary: summarizeResults(results),
    results,
  };
}
