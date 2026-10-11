import { NextResponse } from "next/server";
import { COOKIE_NAME, isValidCode, SESSION_COOKIE, sessionToken, wrongCodeDelay } from "@/lib/auth";

// Plain HTML form POST target: works with zero client JS.
export async function POST(request: Request) {
  const code = process.env.ACCESS_CODE;
  // No ACCESS_CODE: the gate is off, nothing to log into.
  if (!code) return NextResponse.redirect(new URL("/", request.url), 303);

  const form = await request.formData().catch(() => null);
  const input = String(form?.get("code") ?? "");
  if (!(await isValidCode(input, code))) {
    await wrongCodeDelay();
    return NextResponse.redirect(new URL("/login?e=1", request.url), 303);
  }

  const res = NextResponse.redirect(new URL("/", request.url), 303);
  res.cookies.set(COOKIE_NAME, await sessionToken(code), SESSION_COOKIE);
  return res;
}
