import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { queryInbox } from "@/lib/inbox";
import { markAllAsRead } from "@/lib/provider-store";

const querySchema = z.object({
  source: z.enum(["all", "gmail", "outlook", "qq", "mail163"]).optional(),
  mailbox: z.string().optional(),
  filter: z.enum(["all", "unread", "attachments", "verification"]).optional(),
  message: z.string().optional(),
});

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams.entries()),
  );

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid inbox query", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  return NextResponse.json(
    await queryInbox({
      source: parsed.data.source,
      mailboxId: parsed.data.mailbox,
      filter: parsed.data.filter,
      selectedId: parsed.data.message,
    }),
  );
}

const postSchema = z.object({
  source: z.enum(["all", "gmail", "outlook", "qq", "mail163"]).optional(),
  mailbox: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const parsed = postSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid post body", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  markAllAsRead({
    source: parsed.data.source,
    mailboxId: parsed.data.source === "all" ? undefined : parsed.data.mailbox,
  });

  return NextResponse.json({ success: true });
}
