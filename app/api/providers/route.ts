import { NextResponse } from "next/server";
import { queryInbox } from "@/lib/inbox";

export async function GET() {
  return NextResponse.json((await queryInbox({})).providers);
}
