import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/openart/admin";
import { disconnect } from "@/lib/openart/connection";

// Revokes the tokens at OpenArt and deletes them here.
export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  await disconnect();
  return NextResponse.redirect(new URL("/admin/openart?ok=disconnected", request.url), 303);
}
