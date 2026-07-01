import { NextResponse } from "next/server";
import { hydrateMessageDetail } from "@/lib/provider-sync";

export async function POST(
  _request: Request,
  context: { params: Promise<{ messageId: string }> },
) {
  const { messageId } = await context.params;

  try {
    await hydrateMessageDetail(messageId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "邮件详情拉取失败" },
      { status: 500 },
    );
  }
}
