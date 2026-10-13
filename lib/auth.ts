// Access-code auth. Uses Web Crypto so it runs in both the proxy and route handlers.

export const COOKIE_NAME = "ai_chat_session";
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 365 days

export const SESSION_COOKIE = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const, // lets the magic link set it on a top-level navigation from another app
  path: "/",
  maxAge: COOKIE_MAX_AGE,
};

// Delay per wrong code: basic brute-force protection.
// ponytail: fixed delay per wrong attempt; add per-IP rate limiting if the code ever gets guessed at scale.
export const wrongCodeDelay = () => new Promise((r) => setTimeout(r, 1000));

async function hmac(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

// The cookie holds a token derived from the code, never the code itself.
// Changing ACCESS_CODE invalidates every existing session.
export function sessionToken(code: string): Promise<string> {
  return hmac(code, "ai-chat-session-v1");
}

export async function isValidCode(input: string, code: string | undefined): Promise<boolean> {
  if (!code || !input) return false;
  // Compare fixed-length digests so timing doesn't leak how much of the code matched.
  return (await hmac("cmp", input.trim())) === (await hmac("cmp", code));
}

// Owner-only admin pages (/admin/*) use their own code, separate from the friend's ACCESS_CODE.
export const ADMIN_COOKIE = "ai_chat_admin";
export const ADMIN_COOKIE_OPTIONS = { ...SESSION_COOKIE, maxAge: 60 * 60 * 24 * 30 };
export const adminToken = (code: string) => hmac(code, "ai-chat-admin-v1");

export async function isAdmin(cookie: string | undefined, code = process.env.ADMIN_CODE): Promise<boolean> {
  if (!cookie || !code) return false;
  return cookie === (await adminToken(code));
}

export async function isValidSession(
  cookie: string | undefined,
  code: string | undefined,
): Promise<boolean> {
  if (!cookie || !code) return false;
  return cookie === (await sessionToken(code));
}
