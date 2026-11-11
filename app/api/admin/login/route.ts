import { NextResponse } from "next/server";
import { ADMIN_COOKIE, ADMIN_COOKIE_OPTIONS, adminToken, isValidCode, wrongCodeDelay } from "@/lib/auth";

// Admin form login (ADMIN_CODE). No ADMIN_CODE configured = admin pages don't exist.
export async function POST(request: Request) {
  const code = process.env.ADMIN_CODE;
  if (!code) return new Response(null, { status: 404 });
  const form = await request.formData().catch(() => null);
  const destination = form?.get("next") === "/admin/archive" ? "/admin/archive" : "/admin/openart";
  if (!(await isValidCode(String(form?.get("code") ?? ""), code))) {
    await wrongCodeDelay();
    return NextResponse.redirect(new URL(destination + "?e=code", request.url), 303);
  }
  const res = NextResponse.redirect(new URL(destination, request.url), 303);
  res.cookies.set(ADMIN_COOKIE, await adminToken(code), ADMIN_COOKIE_OPTIONS);
  return res;
}
