import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_NAME, isValidSession } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  const ok = await isValidSession(
    request.cookies.get(COOKIE_NAME)?.value,
    process.env.ACCESS_CODE,
  );
  if (ok) return NextResponse.next();

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "נדרשת כניסה עם קוד גישה." }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  // Everything except the login page/endpoint, Next internals and static icons.
  matcher: ["/((?!login|api/login|_next/static|_next/image|icon.svg).*)"],
};
