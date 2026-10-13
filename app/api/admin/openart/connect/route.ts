import { NextResponse } from "next/server";
import { callbackUrl, requireAdmin } from "@/lib/openart/admin";
import { configured, startConnect } from "@/lib/openart/connection";

export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (!configured()) return NextResponse.redirect(new URL("/admin/openart?e=config", request.url), 303);
  try {
    return NextResponse.redirect(await startConnect(callbackUrl(request)), 303);
  } catch (e) {
    console.error("OpenArt connect failed:", (e as Error).message);
    return NextResponse.redirect(new URL("/admin/openart?e=connect", request.url), 303);
  }
}
