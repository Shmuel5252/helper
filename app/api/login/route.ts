import { NextResponse } from "next/server";
import { COOKIE_MAX_AGE, COOKIE_NAME, isValidCode, sessionToken } from "@/lib/auth";

// Plain HTML form POST target: works with zero client JS.
export async function POST(request: Request) {
  const code = process.env.ACCESS_CODE;
  const form = await request.formData().catch(() => null);
  const input = String(form?.get("code") ?? "");

  if (!code || !(await isValidCode(input, code))) {
    // ponytail: fixed delay per wrong attempt; add per-IP rate limiting if the code ever gets guessed at scale.
    await new Promise((r) => setTimeout(r, 1000));
    return NextResponse.redirect(new URL("/login?e=1", request.url), 303);
  }

  const res = NextResponse.redirect(new URL("/", request.url), 303);
  res.cookies.set(COOKIE_NAME, await sessionToken(code), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  return res;
}
