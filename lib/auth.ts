// Access-code auth. Uses Web Crypto so it runs in both the proxy and route handlers.

export const COOKIE_NAME = "ai_chat_session";
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 90; // 90 days

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

export async function isValidSession(
  cookie: string | undefined,
  code: string | undefined,
): Promise<boolean> {
  if (!cookie || !code) return false;
  return cookie === (await sessionToken(code));
}
