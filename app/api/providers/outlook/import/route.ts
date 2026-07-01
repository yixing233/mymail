import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { saveOutlookBulkImport } from "@/lib/outlook-bulk-import";

const importSchema = z.object({
  payload: z.string().min(1, "缺少导入内容"),
});

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = importSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid import payload", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const result = saveOutlookBulkImport(parsed.data.payload);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Outlook 批量导入失败" },
      { status: 400 },
    );
  }
}
