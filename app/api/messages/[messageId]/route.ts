import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { markMessageAsRead, markMessageAsUnread, deleteMessage } from "@/lib/provider-store";

const actionSchema = z.object({
  action: z.enum(["read", "unread", "delete"]),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ messageId: string }> },
) {
  const { messageId } = await context.params;
  const body = await request.json().catch(() => ({}));
  const parsed = actionSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid action", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { action } = parsed.data;

  try {
    if (action === "read") {
      markMessageAsRead(messageId);
    } else if (action === "unread") {
      markMessageAsUnread(messageId);
    } else if (action === "delete") {
      deleteMessage(messageId);
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "操作失败" },
      { status: 500 },
    );
  }
}
