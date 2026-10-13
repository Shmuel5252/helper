import "server-only";
import { decrypt, encrypt } from "./crypto";
import { getJson, redis, redisConfigured, setJson } from "./redis";

// The server-side link to the owner's OpenArt account: OAuth 2.1 (dynamic client registration,
// PKCE, public client), tokens encrypted in Redis, refresh guarded by a Redis lock.
// The refresh token rotates on every refresh, so the newest one must always be stored and an
// old one never reused: every refresh re-reads the stored set inside the lock.

export const MCP_URL = process.env.OPENART_MCP_URL || "https://mcp.openart.ai/mcp";
const KEY = process.env.OPENART_TOKEN_KEY;
const CLIENT_NAME = "ai-chat (Shmuel)";

const K = {
  tokens: "openart:tokens",
  status: "openart:status",
  lock: "openart:refresh-lock",
  client: (redirectUri: string) => `openart:client:${redirectUri}`,
  pkce: (state: string) => `openart:pkce:${state}`,
};

export type Tokens = {
  access_token: string;
  refresh_token: string;
  client_id: string; // the client that obtained this chain; refreshes must use it
  expires_at: number;
  refreshed_at: number;
};
export type Status = { state: "broken"; reason: string; at: number };

export class NotConnected extends Error {}

export const configured = () => redisConfigured() && !!KEY;

// ---- Discovery and client registration ----

type AuthServer = { authorization_endpoint: string; token_endpoint: string; registration_endpoint: string; revocation_endpoint?: string };
let asCache: AuthServer | null = null;

async function authServer(): Promise<AuthServer> {
  if (asCache) return asCache;
  const u = new URL(MCP_URL);
  const prm = await (await fetch(`${u.origin}/.well-known/oauth-protected-resource${u.pathname}`, { cache: "no-store" })).json();
  const issuer: string = prm.authorization_servers[0];
  asCache = await (await fetch(`${issuer}/.well-known/oauth-authorization-server`, { cache: "no-store" })).json();
  return asCache!;
}

// One registered client per redirect URI, so localhost and production each get their own.
async function client(redirectUri: string): Promise<{ client_id: string }> {
  const saved = await getJson<{ client_id: string }>(K.client(redirectUri));
  if (saved) return saved;
  const res = await fetch((await authServer()).registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: CLIENT_NAME,
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "full_access",
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.client_id) throw new Error(`OpenArt client registration failed (${res.status})`);
  await setJson(K.client(redirectUri), { client_id: body.client_id });
  return { client_id: body.client_id };
}

const b64url = (b: Uint8Array) => Buffer.from(b).toString("base64url");

// ---- Interactive connect (admin page) ----

export async function startConnect(redirectUri: string): Promise<string> {
  const { client_id } = await client(redirectUri);
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  await setJson(K.pkce(state), { verifier, redirectUri }, 600);
  const u = new URL((await authServer()).authorization_endpoint);
  u.search = new URLSearchParams({
    response_type: "code",
    client_id,
    redirect_uri: redirectUri,
    scope: "full_access",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: MCP_URL,
  }).toString();
  return u.toString();
}

export async function finishConnect(code: string, state: string): Promise<void> {
  const saved = await getJson<{ verifier: string; redirectUri: string }>(K.pkce(state));
  if (!saved) throw new Error("expired or unknown state");
  await redis("DEL", K.pkce(state));
  const { client_id } = await client(saved.redirectUri);
  const t = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: saved.redirectUri,
    client_id,
    code_verifier: saved.verifier,
    resource: MCP_URL,
  });
  if (!t.refresh_token) throw new Error("OpenArt returned no refresh token");
  await saveTokens({ ...t, refresh_token: t.refresh_token }, client_id);
  await redis("DEL", K.status);
}

// ---- Token set ----

type TokenResponse = { access_token: string; refresh_token?: string; expires_in?: number };

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch((await authServer()).token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(params),
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    const err = new Error(`token endpoint ${res.status}: ${body.error ?? "no access token"}`);
    // invalid_grant / 400 / 401 = the refresh token chain is gone; anything else may be transient.
    (err as Error & { permanent?: boolean }).permanent = res.status === 400 || res.status === 401;
    throw err;
  }
  return body;
}

async function saveTokens(t: TokenResponse & { refresh_token: string }, client_id: string) {
  const now = Date.now();
  const set: Tokens = {
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    client_id,
    expires_at: now + (t.expires_in ?? 3600) * 1000,
    refreshed_at: now,
  };
  await redis("SET", K.tokens, await encrypt(JSON.stringify(set), KEY!));
  return set;
}

async function loadTokens(): Promise<Tokens | null> {
  const sealed = await redis<string | null>("GET", K.tokens);
  return sealed ? (JSON.parse(await decrypt(sealed, KEY!)) as Tokens) : null;
}

export async function status(): Promise<{ connected: boolean; tokens: Pick<Tokens, "expires_at" | "refreshed_at"> | null; broken: Status | null }> {
  const [t, broken] = await Promise.all([loadTokens(), getJson<Status>(K.status)]);
  return { connected: !!t, tokens: t && { expires_at: t.expires_at, refreshed_at: t.refreshed_at }, broken };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A usable access token. `failed`: the token that just got a 401, or "force" (daily cron):
// in both cases it is refreshed rather than reused. Only one refresh runs at a time across all
// instances (Redis SET NX lock); the others wait and pick up the stored result.
export async function accessToken({ failed }: { failed?: string } = {}): Promise<string> {
  if (!configured()) throw new NotConnected("not configured");
  const valid = (t: Tokens) => t.expires_at - Date.now() > 60_000;

  const seen = await loadTokens();
  if (!seen) throw new NotConnected("not connected");
  if (valid(seen) && !failed) return seen.access_token;
  // Refresh needed. "Someone else already did it" = the stored token changed and is valid.
  const refreshedMeanwhile = (t: Tokens) => t.access_token !== seen.access_token && valid(t);

  const lockId = b64url(crypto.getRandomValues(new Uint8Array(12)));
  for (let i = 0; i < 60; i++) {
    if ((await redis("SET", K.lock, lockId, "NX", "PX", 15_000)) === "OK") {
      try {
        const t = await loadTokens(); // always the newest set: never reuse an old refresh token
        if (!t) throw new NotConnected("not connected");
        if (refreshedMeanwhile(t)) return t.access_token;
        let next: TokenResponse;
        try {
          next = await tokenRequest({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: t.client_id, resource: MCP_URL });
        } catch (e) {
          if ((e as { permanent?: boolean }).permanent) {
            // The chain is dead (revoked, expired, or rotated elsewhere): needs a new connect.
            await redis("DEL", K.tokens);
            await setJson(K.status, { state: "broken", reason: (e as Error).message, at: Date.now() } satisfies Status);
            throw new NotConnected("refresh rejected");
          }
          throw e;
        }
        return (await saveTokens({ ...next, refresh_token: next.refresh_token ?? t.refresh_token }, t.client_id)).access_token;
      } finally {
        if ((await redis<string | null>("GET", K.lock)) === lockId) await redis("DEL", K.lock);
      }
    }
    await sleep(250);
    const now = await loadTokens();
    if (!now) throw new NotConnected("not connected");
    if (refreshedMeanwhile(now)) return now.access_token;
  }
  throw new Error("timed out waiting for the OpenArt token refresh");
}

export async function disconnect(): Promise<void> {
  const t = await loadTokens().catch(() => null);
  const as = await authServer().catch(() => null);
  if (t && as?.revocation_endpoint) {
    for (const [hint, token] of [["refresh_token", t.refresh_token], ["access_token", t.access_token]] as const) {
      await fetch(as.revocation_endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token, token_type_hint: hint, client_id: t.client_id }),
      }).catch(() => {});
    }
  }
  await redis("DEL", K.tokens, K.status);
}
