import { connection, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/openart/admin";
import { finishConnect } from "@/lib/openart/connection";

export async function GET(request: Request) {
  await connection(); // always at request time: env (ADMIN_CODE) may differ from build time
  const denied = await requireAdmin();
  if (denied) return denied;
  const u = new URL(request.url);
  const code = u.searchParams.get("code");
  const state = u.searchParams.get("state");
  if (!code || !state) return NextResponse.redirect(new URL("/admin/openart?e=denied", request.url));
  try {
    await finishConnect(code, state);
    return NextResponse.redirect(new URL("/admin/openart?ok=connected", request.url));
  } catch (e) {
    console.error("OpenArt callback failed:", (e as Error).message);
    return NextResponse.redirect(new URL("/admin/openart?e=callback", request.url));
  }
}
