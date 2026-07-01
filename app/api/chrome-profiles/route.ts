import { NextResponse } from "next/server";
import { listChromeProfiles } from "@/lib/chrome";

export async function GET() {
  return NextResponse.json({ profiles: listChromeProfiles() });
}
