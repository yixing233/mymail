import { getMessageDetail, listMessages, markMessageAsRead } from "@/lib/provider-store";
import { getDefaultProviders } from "@/lib/providers";
import type {
  InboxPayload,
  MailFilter,
  ProviderId,
} from "@/lib/types";

export async function queryInbox({
  source = "all",
  mailboxId,
  filter = "all",
  selectedId: _selectedId,
  search = "",
}: {
  source?: ProviderId | "all";
  mailboxId?: string;
  filter?: MailFilter;
  selectedId?: string;
  search?: string;
}): Promise<InboxPayload> {
  const allMessages = listMessages();
  const providers = getDefaultProviders();
  const verificationKeywords = ["验证码", "安全代码", "verification code", "code", "验证码邮件"];
  const activeMailboxId = source === "all" ? undefined : mailboxId;

  const filtered = allMessages.filter((message) => {
    const sourceMatch = source === "all" ? true : message.providerId === source;
    const mailboxMatch = activeMailboxId ? message.mailboxId === activeMailboxId : true;
    const filterMatch =
      filter === "all"
        ? true
        : filter === "unread"
          ? message.unread
          : filter === "attachments"
            ? message.hasAttachments
            : verificationKeywords.some((keyword) =>
                `${message.subject} ${message.preview} ${message.from}`.toLowerCase().includes(keyword.toLowerCase()),
              );

    const searchMatch = search
      ? `${message.subject} ${message.preview} ${message.from}`.toLowerCase().includes(search.toLowerCase())
      : true;

    return sourceMatch && mailboxMatch && filterMatch && searchMatch;
  });

  const selectedId = _selectedId && filtered.some((message) => message.id === _selectedId)
    ? _selectedId
    : filtered[0]?.id;

  const manuallySelectedMessage = _selectedId
    ? filtered.find((message) => message.id === _selectedId)
    : undefined;

  if (manuallySelectedMessage?.unread) {
    markMessageAsRead(manuallySelectedMessage.id);
  }

  const messages = manuallySelectedMessage?.unread
    ? filtered.map((message) =>
        message.id === manuallySelectedMessage.id ? { ...message, unread: false } : message,
      )
    : filtered;
  const selectedMessage = selectedId ? getMessageDetail(selectedId) : undefined;

  return {
    providers,
    messages,
    selectedMessage,
  };
}
