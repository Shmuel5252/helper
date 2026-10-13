// OpenArt integration checks against the mocks (no browser): admin protection, OAuth connect,
// encrypted token storage, rotation, refresh lock, 401 handling, broken chain, cron, disconnect,
// and (milestone 2) the generation API and media proxy.
// Needs: node tests/mock-openart.mjs, node tests/mock-upstash.mjs, node tests/start-test-app.mjs
import assert from "node:assert/strict";
import crypto from "node:crypto";

const BASE = process.env.BASE_URL ?? "http://localhost:3101";
const OA = "http://localhost:4020";
const KV = "http://localhost:4030";
const KEY = Buffer.alloc(32, 7); // same fixed test key as tests/start-test-app.mjs

const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(`PASS  ${name}`);
  } catch (e) {
    results.push(`FAIL  ${name}: ${e.message.split("\n")[0]}`);
  }
  console.log(results.at(-1));
};

const cookieOf = (res) => (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
const req = (path, { method = "GET", cookie, headers = {}, body } = {}) =>
  fetch(path.startsWith("http") ? path : BASE + path, {
    method,
    redirect: "manual",
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body,
  });
const form = (data) => ({ body: new URLSearchParams(data) }); // fetch sets the form content type
const control = (c) => fetch(`${OA}/__control`, { method: "POST", body: JSON.stringify(c) });
const state = () => fetch(`${OA}/__state`).then((r) => r.json());
const stored = async () => {
  const { value } = await fetch(`${KV}/__dump?key=openart:tokens`).then((r) => r.json());
  if (!value) return { raw: null, tokens: null };
  const buf = Buffer.from(value, "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", KEY, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(buf.length - 16));
  const plain = Buffer.concat([d.update(buf.subarray(12, buf.length - 16)), d.final()]).toString();
  return { raw: value, tokens: JSON.parse(plain) };
};
const adminPage = (cookie) => req("/admin/openart", { cookie }).then((r) => r.text());

await control({ reset: true });
await fetch(`${KV}/__flush`, { method: "POST" });

// ---------- Milestone 1: connection ----------
let admin = "";
let friend = "";

await check("admin page without the admin code shows only the login form", async () => {
  const html = await adminPage();
  assert.match(html, /name="code"/);
  assert.doesNotMatch(html, /data-testid="openart-status"/);
});

await check("admin actions refuse requests without the admin cookie (including the friend's)", async () => {
  friend = cookieOf(await req("/api/login", { method: "POST", ...form({ code: "test-code-123" }) }));
  assert.match(friend, /ai_chat_session=/);
  for (const [path, method] of [
    ["/api/admin/openart/connect", "POST"],
    ["/api/admin/openart/disconnect", "POST"],
    ["/api/admin/openart/callback?code=x&state=y", "GET"],
  ]) {
    assert.equal((await req(path, { method })).status, 403, path);
    assert.equal((await req(path, { method, cookie: friend })).status, 403, `${path} with friend cookie`);
  }
});

await check("admin login: wrong code rejected after a delay, right code sets the admin cookie", async () => {
  const t0 = Date.now();
  const bad = await req("/api/admin/login", { method: "POST", ...form({ code: "nope" }) });
  assert.ok(Date.now() - t0 >= 1000);
  assert.match(bad.headers.get("location"), /e=code/);
  const good = await req("/api/admin/login", { method: "POST", ...form({ code: "admin-test" }) });
  admin = cookieOf(good);
  assert.match(admin, /ai_chat_admin=/);
});

await check("connect: DCR with an honest client name, PKCE, callback to this origin", async () => {
  const start = await req("/api/admin/openart/connect", { method: "POST", cookie: admin });
  assert.equal(start.status, 303);
  const authorize = new URL(start.headers.get("location"));
  assert.equal(authorize.origin, OA);
  assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authorize.searchParams.get("redirect_uri"), `${BASE}/api/admin/openart/callback`);
  const approved = await req(authorize.toString()); // the mock auto-approves
  const callback = await req(approved.headers.get("location"), { cookie: admin });
  assert.match(callback.headers.get("location"), /ok=connected/);
  const s = await state();
  assert.deepEqual(s.clients.map((c) => c.client_name), ["ai-chat (Shmuel)"]);
  const html = await adminPage(admin);
  assert.match(html, /מחובר/);
  assert.match(html, /data-testid="balance">2800</);
});

await check("tokens are stored encrypted (no plaintext token in Redis)", async () => {
  const s = await state();
  const { raw, tokens } = await stored();
  assert.ok(raw && !raw.includes(s.lastAccessToken) && !raw.includes(s.lastRefreshToken));
  assert.equal(tokens.refresh_token, s.lastRefreshToken);
});

await check("cron: rejects missing/wrong secret; refreshes with it and persists the rotated token", async () => {
  assert.equal((await req("/api/cron/openart-refresh")).status, 401);
  assert.equal((await req("/api/cron/openart-refresh", { headers: { Authorization: "Bearer wrong" } })).status, 401);
  const before = await state();
  const ok = await req("/api/cron/openart-refresh", { headers: { Authorization: "Bearer cron-test" } });
  assert.equal(ok.status, 200);
  const after = await state();
  assert.equal(after.refreshCount, before.refreshCount + 1);
  assert.equal((await stored()).tokens.refresh_token, after.lastRefreshToken, "newest refresh token stored");
});

await check("lock: 6 concurrent forced refreshes cause exactly one refresh", async () => {
  await control({ refreshDelayMs: 700 });
  const before = (await state()).refreshCount;
  const all = await Promise.all(Array.from({ length: 6 }, () => req("/api/cron/openart-refresh", { headers: { Authorization: "Bearer cron-test" } })));
  assert.deepEqual(all.map((r) => r.status), [200, 200, 200, 200, 200, 200]);
  assert.equal((await state()).refreshCount, before + 1);
  await control({ refreshDelayMs: 0 });
});

await check("expired access token: 401 → one refresh for 6 concurrent requests, all succeed", async () => {
  await control({ expireAccessTokens: true, refreshDelayMs: 500 });
  const before = (await state()).refreshCount;
  const pages = await Promise.all(Array.from({ length: 6 }, () => adminPage(admin)));
  for (const html of pages) assert.match(html, /data-testid="balance">2800</);
  const s = await state();
  assert.equal(s.refreshCount, before + 1);
  assert.equal(s.deadChains, 0, "an old refresh token was never reused");
  await control({ refreshDelayMs: 0 });
});

await check("refresh rejected → marked broken, tokens deleted; reconnect works", async () => {
  await control({ expireAccessTokens: true, failRefresh: true });
  const html = await adminPage(admin);
  assert.match(html, /החיבור נשבר/);
  assert.equal((await stored()).raw, null);
  await control({ failRefresh: false });
  const start = await req("/api/admin/openart/connect", { method: "POST", cookie: admin });
  const approved = await req(start.headers.get("location"));
  await req(approved.headers.get("location"), { cookie: admin });
  assert.match(await adminPage(admin), /data-testid="balance">2800</);
});

await check("disconnect revokes at OpenArt and deletes the tokens", async () => {
  const r = await req("/api/admin/openart/disconnect", { method: "POST", cookie: admin });
  assert.match(r.headers.get("location"), /ok=disconnected/);
  const s = await state();
  assert.ok(s.revoked.includes("refresh_token") && s.revoked.includes("access_token"));
  assert.equal((await stored()).raw, null);
  assert.match(await adminPage(admin), /לא מחובר/);
});

console.log("\n" + results.join("\n"));
process.exitCode = results.some((r) => r.startsWith("FAIL")) ? 1 : 0;
