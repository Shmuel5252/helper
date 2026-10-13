// OAuth 2.1 for the OpenArt MCP server: discovery, dynamic client registration, PKCE login,
// refresh. Secrets live only in ./.secrets/ (git-ignored) and are never printed.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const MCP_URL = "https://mcp.openart.ai/mcp";
export const REDIRECT_URI = "http://127.0.0.1:8765/callback";
const DIR = path.join(import.meta.dirname, ".secrets");
const CLIENT_FILE = path.join(DIR, "client.json");
const TOKEN_FILE = path.join(DIR, "tokens.json");

const b64url = (buf) => Buffer.from(buf).toString("base64url");
// Safe to show: a short one-way fingerprint, to tell tokens apart without revealing them.
export const fp = (s) => (s ? crypto.createHash("sha256").update(s).digest("hex").slice(0, 8) : "-");

export async function discover() {
  const prm = await (await fetch("https://mcp.openart.ai/.well-known/oauth-protected-resource/mcp")).json();
  const issuer = prm.authorization_servers[0];
  const as = await (await fetch(`${issuer}/.well-known/oauth-authorization-server`)).json();
  return { prm, as };
}

function read(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}
function write(file, data) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });
}
export const loadTokens = () => read(TOKEN_FILE);

// Dynamic client registration (RFC 7591), once; the client is public (PKCE, no secret).
export async function getClient(as) {
  const saved = read(CLIENT_FILE);
  if (saved?.client_id) return saved;
  const res = await fetch(as.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "ai-chat feasibility spike",
      redirect_uris: [REDIRECT_URI],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "full_access",
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.client_id) throw new Error(`registration failed: ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  write(CLIENT_FILE, body);
  return body;
}

export function pkce() {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge, state: b64url(crypto.randomBytes(16)) };
}

export function authorizeUrl(as, client, p) {
  const u = new URL(as.authorization_endpoint);
  u.search = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: REDIRECT_URI,
    scope: "full_access",
    state: p.state,
    code_challenge: p.challenge,
    code_challenge_method: "S256",
    resource: MCP_URL, // RFC 8707: token audience = the MCP server
  });
  return u.toString();
}

async function tokenRequest(as, params) {
  const res = await fetch(as.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(params),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    // Error bodies carry no tokens, but trim them anyway.
    throw new Error(`token endpoint ${res.status}: ${JSON.stringify({ error: body.error, error_description: body.error_description })}`);
  }
  const now = Date.now();
  const tokens = {
    ...body,
    obtained_at: now,
    expires_at: body.expires_in ? now + body.expires_in * 1000 : null,
  };
  write(TOKEN_FILE, tokens);
  return tokens;
}

export const exchangeCode = (as, client, code, verifier) =>
  tokenRequest(as, {
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: client.client_id,
    code_verifier: verifier,
    resource: MCP_URL,
  });

export async function refresh(as, client) {
  const old = loadTokens();
  if (!old?.refresh_token) throw new Error("no refresh token stored");
  const next = await tokenRequest(as, {
    grant_type: "refresh_token",
    refresh_token: old.refresh_token,
    client_id: client.client_id,
    resource: MCP_URL,
  });
  // The server may or may not send a new refresh token; keep the old one if it doesn't.
  if (!next.refresh_token) write(TOKEN_FILE, { ...next, refresh_token: old.refresh_token, refresh_token_rotated: false });
  return { old, next: loadTokens() };
}

// What a token says about itself, without the token: JWT claims if it is one, plus lengths.
export function describe(tokens) {
  if (!tokens) return "no tokens";
  const claims = (() => {
    const parts = tokens.access_token.split(".");
    if (parts.length !== 3) return "opaque (not a JWT)";
    try {
      const c = JSON.parse(Buffer.from(parts[1], "base64url").toString());
      const pick = ({ iss, aud, exp, iat, scope, client_id }) => ({ iss, aud, scope, client_id: client_id && "<set>", iat, exp });
      return pick(c);
    } catch {
      return "unparseable";
    }
  })();
  return {
    token_type: tokens.token_type,
    scope: tokens.scope,
    expires_in_s: tokens.expires_in ?? null,
    expires_at: tokens.expires_at ? new Date(tokens.expires_at).toISOString() : null,
    refresh_expires_in_s: tokens.refresh_token_expires_in ?? tokens.refresh_expires_in ?? null,
    access_token: { length: tokens.access_token.length, fp: fp(tokens.access_token), claims },
    refresh_token: tokens.refresh_token ? { length: tokens.refresh_token.length, fp: fp(tokens.refresh_token) } : null,
    other_fields: Object.keys(tokens).filter(
      (k) => !["access_token", "refresh_token", "token_type", "scope", "expires_in", "obtained_at", "expires_at"].includes(k),
    ),
  };
}
