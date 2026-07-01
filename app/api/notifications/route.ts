import { NextResponse } from "next/server";
import { getNotificationsEnabled } from "@/lib/app-settings";
import { listProviderConfigs, listRecentMessages } from "@/lib/provider-store";

export async function GET() {
  const accountByMailboxId = new Map(
    listProviderConfigs().flatMap((provider) =>
      provider.mailboxes.map((mailbox) => [mailbox.id, mailbox.account] as const),
    ),
  );

  return NextResponse.json({
    enabled: getNotificationsEnabled(),
    messages: listRecentMessages(20).map((message) => ({
      id: message.id,
      mailboxId: message.mailboxId,
      providerId: message.providerId,
      providerLabel: message.providerLabel,
      account: accountByMailboxId.get(message.mailboxId) ?? message.providerLabel,
      from: message.from,
      subject: message.subject,
      preview: message.preview,
      receivedAt: message.receivedAt,
    })),
  });
}
