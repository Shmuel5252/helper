// Mock of OpenArt's OAuth server, MCP endpoint, uploads and CDN, for tests (port 4020).
// Behaves like the real service in the ways the app depends on: dynamic client registration,
// PKCE (S256, verified), auto-approval, access tokens that expire, refresh tokens that ROTATE
// (reusing an old one revokes the chain), tool results as SSE, async generations, presigned
// uploads, and a CDN with Range support. Test controls: POST /__control, GET /__state.
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const PORT = Number(process.env.PORT ?? 4020);
const BASE = `http://localhost:${PORT}`;
const FIXTURES = path.join(import.meta.dirname, "fixtures");
const sha = (s) => crypto.createHash("sha256").update(s).digest("base64url");
const rnd = (n = 18) => crypto.randomBytes(n).toString("base64url");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PRICES = {
  "nano-banana-2-lite": () => 15,
  "nano-banana-2": (p) => (p.resolution === "2K" ? 30 : p.resolution === "4K" ? 40 : 20),
  pixverseV6: (p) => Math.round(50 * ((p.duration ?? 5) / 5) * (p.resolution === "720p" ? 1.4 : 1)),
  "veo3-1": (p) => Math.round(20 * (p.duration ?? 4) * (p.resolution === "1080p" ? 1.5 : 1)),
};
const VIDEO_MODELS = new Set(["pixverseV6", "veo3-1"]);

const initial = () => ({
  clients: new Map(), // client_id -> { redirect_uris, client_name }
  codes: new Map(), // code -> { client_id, challenge, redirect_uri }
  access: new Map(), // token -> { expiresAt, chain }
  refresh: new Map(), // token -> { chain, used }
  deadChains: new Set(),
  refreshCount: 0,
  revoked: [],
  balance: 2800,
  costMultiplier: 1,
  tokenTtlMs: 3_600_000,
  refreshDelayMs: 0,
  failRefresh: false,
  generateError: null, // e.g. "Insufficient credits"
  jobs: new Map(), // historyId -> job
  uploads: new Map(), // uploadId -> { bytes, contentType }
  lastAccessToken: null,
  lastRefreshToken: null,
  calls: [], // tool names, in order
});
let S = initial();

function issue(chain) {
  const access_token = `at_${rnd()}`;
  const refresh_token = `rt_${rnd()}`;
  S.access.set(access_token, { expiresAt: Date.now() + S.tokenTtlMs, chain });
  S.refresh.set(refresh_token, { chain, used: false });
  S.lastAccessToken = access_token;
  S.lastRefreshToken = refresh_token;
  return { access_token, refresh_token, token_type: "Bearer", expires_in: Math.round(S.tokenTtlMs / 1000), scope: "full_access" };
}

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
};
const readBody = async (req) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
};

function resourceFor(job) {
  const id = job.historyId;
  return job.kind === "video"
    ? { id: `r_${id}`, mediaType: "video", url: `${BASE}/cdn/videos/${id}.webm`, thumbnailUrl: `${BASE}/cdn/images/${id}-poster.png`, metadata: { width: 640, height: 640, duration: 2, fps: 24, hasAudio: false } }
    : { id: `r_${id}`, mediaType: "image", url: `${BASE}/cdn/images/${id}.png`, thumbnailUrl: `${BASE}/cdn/images/${id}.png`, metadata: { width: 640, height: 640, format: "png" } };
}

function jobStatus(job) {
  const age = Date.now() - job.createdAt;
  const doneAfter = job.kind === "video" ? 2500 : 1200;
  const base = { historyId: job.historyId, prompt: job.params.prompt, capabilityId: `${job.model}:${job.mode}` };
  if (job.cancelled) return { ...base, status: "CANCELLED" };
  if (age < 400) return { ...base, status: "PENDING", pollAfterSeconds: 1 };
  if (age < doneAfter) return { ...base, status: "RUNNING", pollAfterSeconds: 1 };
  if (/חסום|blocked/i.test(job.params.prompt ?? ""))
    return { ...base, status: "FAILED", error: "Prompt rejected by content moderation", failedCode: "content_policy", creditsCharged: 0, creditsRefunded: job.cost };
  if (/נכשל|fail/i.test(job.params.prompt ?? ""))
    return { ...base, status: "FAILED", error: "upstream timeout", failedCode: "system_error", creditsCharged: 0, creditsRefunded: job.cost };
  return { ...base, status: "COMPLETED", creditsCharged: job.cost, resourceCount: 1, resources: [resourceFor(job)] };
}

const TOOLS = {
  openart_account_get: () => ({ user: { uid: "u_mock", email: "owner@example.com" }, plan: "Plus", credits: S.balance }), // real shape
  openart_model_list: () => ({ balance: S.balance, models: Object.keys(PRICES).map((id) => ({ id })) }),
  openart_model_cost: ({ model, mode, params = {} }) => {
    if (!PRICES[model]) throw new Error(`unknown model ${model}`);
    const total = Math.round(PRICES[model](params) * S.costMultiplier);
    return { currency: "credits", balance: S.balance, items: [{ model, mode, config: params, unitCredits: total, quantity: 1, totalCredits: total, affordable: total <= S.balance }] };
  },
  openart_upload_sign: ({ mediaType, size, contentType, filename }) => {
    const uploadId = `up_${rnd(8)}`;
    S.uploads.set(uploadId, { size, contentType, bytes: null });
    const accessURL = `${BASE}/cdn/uploads/${uploadId}`;
    return { uploadId, signURL: `${BASE}/upload/${uploadId}`, accessURL, contentType, instructions: "PUT the bytes", visualReference: { type: mediaType, id: uploadId, url: accessURL, label: filename ?? uploadId } };
  },
  openart_upload_metadata_get: ({ mediaUrl, mediaType, uploadId, label }) => {
    const up = S.uploads.get(uploadId);
    if (!up?.bytes) throw new Error("upload not accepted yet");
    return { mediaUrl, mediaType, metadata: { width: 640, height: 640 }, visualReference: { type: mediaType, id: uploadId, url: mediaUrl, label: label ?? uploadId } };
  },
  openart_generate_image: (args) => generate("image", args),
  openart_generate_video: (args) => generate("video", args),
  openart_creation_get: ({ historyId }) => {
    const job = S.jobs.get(historyId);
    if (!job) throw new Error("not found");
    return jobStatus(job);
  },
};

function generate(kind, { model, mode, params }) {
  if (!PRICES[model]) throw new Error(`unknown model ${model}`);
  if ((kind === "video") !== VIDEO_MODELS.has(model)) throw new Error(`${model} cannot make ${kind}`);
  if (!params?.prompt && mode !== "image2video") throw new Error("prompt is required");
  if (mode === "image2video" && !params?.startFrame?.id) throw new Error("startFrame is required");
  if (mode === "image2image" && !params?.visualReferences?.[0]?.id) throw new Error("visualReferences required");
  if (S.generateError) throw new Error(S.generateError);
  const cost = Math.round(PRICES[model](params) * S.costMultiplier);
  if (cost > S.balance) throw new Error("Insufficient credits for this generation");
  S.balance -= cost;
  const historyId = `h_${rnd(10)}`;
  const job = { historyId, kind, model, mode, params, cost, createdAt: Date.now() };
  S.jobs.set(historyId, job);
  return { status: "PENDING", historyId, pollAfterSeconds: 1 };
}

async function mcp(req, res) {
  const auth = req.headers.authorization?.replace(/^Bearer /, "");
  const tok = auth && S.access.get(auth);
  if (!tok || tok.expiresAt <= Date.now() || S.deadChains.has(tok.chain))
    return json(res, 401, { error: "invalid_token" }, { "WWW-Authenticate": `Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp"` });
  const msg = JSON.parse((await readBody(req)).toString());
  if (msg.method === "initialize")
    return json(res, 200, { jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18", serverInfo: { name: "mock-openart", version: "0" }, capabilities: { tools: {} } } }); // stateless like the real server: no Mcp-Session-Id
  if (msg.id === undefined) {
    res.writeHead(202);
    return res.end();
  }
  if (msg.method !== "tools/call") return json(res, 200, { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "method not found" } });
  const { name, arguments: args } = msg.params;
  S.calls.push(name);
  let result;
  try {
    if (!TOOLS[name]) throw new Error(`unknown tool ${name}`);
    const data = TOOLS[name](args ?? {});
    result = { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
  } catch (e) {
    result = { content: [{ type: "text", text: e.message }], isError: true };
  }
  // Like the real server: the reply arrives as a server-sent event.
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result })}\n\n`);
}

async function token(req, res) {
  const p = new URLSearchParams((await readBody(req)).toString());
  if (p.get("grant_type") === "authorization_code") {
    const c = S.codes.get(p.get("code"));
    S.codes.delete(p.get("code"));
    if (!c || c.client_id !== p.get("client_id") || c.redirect_uri !== p.get("redirect_uri") || sha(p.get("code_verifier") ?? "") !== c.challenge)
      return json(res, 400, { error: "invalid_grant" });
    return json(res, 200, issue(rnd(6)));
  }
  if (p.get("grant_type") === "refresh_token") {
    if (S.refreshDelayMs) await sleep(S.refreshDelayMs);
    const r = S.refresh.get(p.get("refresh_token"));
    if (S.failRefresh || !r || S.deadChains.has(r.chain)) return json(res, 400, { error: "invalid_grant" });
    if (r.used) {
      // Reuse of a rotated refresh token: treat as theft and kill the whole chain.
      S.deadChains.add(r.chain);
      return json(res, 400, { error: "invalid_grant", error_description: "refresh token reuse" });
    }
    r.used = true;
    S.refreshCount++;
    return json(res, 200, issue(r.chain));
  }
  json(res, 400, { error: "unsupported_grant_type" });
}

function serveFile(req, res, file, type) {
  const buf = fs.readFileSync(path.join(FIXTURES, file));
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
  const head = { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": "public, max-age=31536000" };
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), buf.length - 1) : buf.length - 1;
    res.writeHead(206, { ...head, "Content-Range": `bytes ${start}-${end}/${buf.length}`, "Content-Length": end - start + 1 });
    return res.end(req.method === "HEAD" ? undefined : buf.subarray(start, end + 1));
  }
  res.writeHead(200, { ...head, "Content-Length": buf.length });
  res.end(req.method === "HEAD" ? undefined : buf);
}

http
  .createServer(async (req, res) => {
    const u = new URL(req.url, BASE);
    try {
      if (u.pathname === "/.well-known/oauth-protected-resource/mcp")
        return json(res, 200, { resource: `${BASE}/mcp`, authorization_servers: [BASE], scopes_supported: ["full_access"] });
      if (u.pathname === "/.well-known/oauth-authorization-server")
        return json(res, 200, {
          issuer: BASE,
          authorization_endpoint: `${BASE}/authorize`,
          token_endpoint: `${BASE}/token`,
          registration_endpoint: `${BASE}/register`,
          revocation_endpoint: `${BASE}/revoke`,
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"],
          grant_types_supported: ["authorization_code", "refresh_token"],
        });
      if (u.pathname === "/register" && req.method === "POST") {
        const body = JSON.parse((await readBody(req)).toString());
        const client_id = `cl_${rnd(8)}`;
        S.clients.set(client_id, body);
        return json(res, 201, { client_id, ...body });
      }
      if (u.pathname === "/authorize") {
        // Auto-approves, as if the owner clicked "Allow" on OpenArt.
        const q = u.searchParams;
        const client = S.clients.get(q.get("client_id"));
        if (!client?.redirect_uris.includes(q.get("redirect_uri")) || q.get("code_challenge_method") !== "S256")
          return json(res, 400, { error: "invalid_request" });
        const code = `code_${rnd(8)}`;
        S.codes.set(code, { client_id: q.get("client_id"), challenge: q.get("code_challenge"), redirect_uri: q.get("redirect_uri") });
        res.writeHead(302, { Location: `${q.get("redirect_uri")}?code=${code}&state=${encodeURIComponent(q.get("state"))}` });
        return res.end();
      }
      if (u.pathname === "/token" && req.method === "POST") return token(req, res);
      if (u.pathname === "/revoke" && req.method === "POST") {
        const p = new URLSearchParams((await readBody(req)).toString());
        const t = p.get("token");
        const chain = S.access.get(t)?.chain ?? S.refresh.get(t)?.chain;
        if (chain) S.deadChains.add(chain);
        S.revoked.push(p.get("token_type_hint"));
        res.writeHead(200);
        return res.end();
      }
      if (u.pathname === "/mcp" && req.method === "POST") return mcp(req, res);
      if (u.pathname.startsWith("/upload/") && req.method === "PUT") {
        const up = S.uploads.get(u.pathname.split("/").pop());
        if (!up) return json(res, 404, {});
        up.bytes = await readBody(req);
        up.contentType = req.headers["content-type"];
        res.writeHead(200);
        return res.end();
      }
      if (u.pathname.startsWith("/cdn/uploads/")) {
        const up = S.uploads.get(u.pathname.split("/").pop());
        if (!up?.bytes) return json(res, 404, {});
        res.writeHead(200, { "Content-Type": up.contentType ?? "image/jpeg" });
        return res.end(up.bytes);
      }
      if (u.pathname.startsWith("/cdn/videos/")) return serveFile(req, res, "sample.webm", "video/webm");
      if (u.pathname.startsWith("/cdn/images/")) return serveFile(req, res, "sample.png", "image/png");

      // ---- test controls ----
      if (u.pathname === "/__control" && req.method === "POST") {
        const c = JSON.parse((await readBody(req)).toString() || "{}");
        if (c.reset) S = initial();
        if (c.expireAccessTokens) for (const a of S.access.values()) a.expiresAt = 0;
        for (const k of ["costMultiplier", "tokenTtlMs", "refreshDelayMs", "failRefresh", "generateError", "balance"]) if (k in c) S[k] = c[k];
        return json(res, 200, { ok: true });
      }
      if (u.pathname === "/__state")
        return json(res, 200, {
          refreshCount: S.refreshCount,
          revoked: S.revoked,
          balance: S.balance,
          clients: [...S.clients.values()].map((c) => ({ client_name: c.client_name, redirect_uris: c.redirect_uris })),
          lastAccessToken: S.lastAccessToken,
          lastRefreshToken: S.lastRefreshToken,
          deadChains: S.deadChains.size,
          jobs: [...S.jobs.values()].map((j) => ({ historyId: j.historyId, kind: j.kind, model: j.model, mode: j.mode, params: j.params, cost: j.cost })),
          calls: S.calls,
        });
      json(res, 404, { error: "not found" });
    } catch (e) {
      json(res, 500, { error: e.message });
    }
  })
  .listen(PORT, () => console.log(`[openart-mock] listening on ${BASE}`));
