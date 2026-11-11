import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_NAME, isValidCode, isValidSession, SESSION_COOKIE, sessionToken, wrongCodeDelay } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  const code = process.env.ACCESS_CODE;
  const url = request.nextUrl;
  const isLogin = url.pathname === "/login";

  // Owner pages and the cron endpoint protect themselves (ADMIN_CODE / CRON_SECRET),
  // independent of the friend's access code.
  if (/^\/(admin|api\/admin|api\/cron)(\/|$)/.test(url.pathname)) return NextResponse.next();
  // This endpoint requires its own dedicated worker credential, never the access code.
  if (url.pathname === '/api/worker/gemini') return NextResponse.next();
  // fal callbacks authenticate their signature and bind the provider request ID.
  if (url.pathname === '/api/fal/webhook') return NextResponse.next();
  // Private files enforce their own per-device or owner-admin authorization.
  if (/^\/api\/gemini\/assets\/[0-9a-f-]+$/i.test(url.pathname)) return NextResponse.next();

  // No ACCESS_CODE: the gate is deliberately off and the site is open.
  if (!code) return isLogin ? NextResponse.redirect(new URL("/", request.url)) : NextResponse.next();

  // Magic link: /?k=<ACCESS_CODE> logs in and drops the code from the address bar.
  const k = url.searchParams.get("k");
  if (k !== null) {
    if (!(await isValidCode(k, code))) {
      await wrongCodeDelay();
      return NextResponse.redirect(new URL("/login?e=1", request.url));
    }
    const clean = url.clone();
    clean.searchParams.delete("k");
    if (isLogin) clean.pathname = "/";
    const res = NextResponse.redirect(clean);
    res.cookies.set(COOKIE_NAME, await sessionToken(code), SESSION_COOKIE);
    return res;
  }

  const ok = await isValidSession(request.cookies.get(COOKIE_NAME)?.value, code);
  if (isLogin) return ok ? NextResponse.redirect(new URL("/", request.url)) : NextResponse.next();
  if (ok) return NextResponse.next();

  if (url.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "נדרשת כניסה עם קוד גישה." }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  // Everything except the login endpoint, Next internals and static icons.
  // /login is included: it's skipped when the gate is off or the visitor is already in.
  matcher: ["/((?!api/login|_next/static|_next/image|icon.svg).*)"],
};
