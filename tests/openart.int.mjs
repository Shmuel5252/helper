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

// ---------- Milestone 2: generation API and media proxy ----------
const api = (path, body) =>
  req(path, { method: body ? "POST" : "GET", cookie: friend, headers: body ? { "Content-Type": "application/json" } : {}, body: body && JSON.stringify(body) }).then(
    async (r) => ({ status: r.status, body: await r.json().catch(() => null) }),
  );
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitDone(id) {
  for (let i = 0; i < 40; i++) {
    const s = await api(`/api/media/status?id=${id}`);
    if (s.body?.status !== "running") return s;
    await sleep(300); // the browser waits pollAfter (≥4s); the mock finishes in ~1–3s
  }
  throw new Error("still running");
}
const usage = () => api("/api/media/config").then((r) => r.body.usage);
const pngDataUrl = `data:image/png;base64,${(await import("node:fs")).readFileSync(new URL("./fixtures/sample.png", import.meta.url)).toString("base64")}`;

await check("config: unavailable while disconnected; generate answers in Hebrew", async () => {
  const c = await api("/api/media/config");
  assert.equal(c.body.available, false);
  const g = await api("/api/media/generate", { kind: "image", key: "lite", prompt: "חתול", credits: 15 });
  assert.equal(g.status, 503);
  assert.equal(g.body.error, "יצירת תמונות וסרטונים לא זמינה כרגע.");
});

await check("media API and proxy require the friend's login", async () => {
  assert.equal((await req("/api/media/config")).status, 401);
  assert.equal((await req("/api/media/quote", { method: "POST", body: "{}" })).status, 401);
  assert.equal((await req("/media/images/x.png")).status, 307);
});

await check("config after connecting: options without model ids, usage 0 of 200", async () => {
  const start = await req("/api/admin/openart/connect", { method: "POST", cookie: admin });
  const approved = await req(start.headers.get("location"));
  await req(approved.headers.get("location"), { cookie: admin });
  const c = (await api("/api/media/config")).body;
  assert.equal(c.available, true);
  assert.deepEqual(c.image.map((o) => o.key), ["lite", "nb2"]);
  assert.deepEqual(c.video.map((o) => [o.key, o.modelName]), [["pixverse", "PixVerse V6"], ["veo", "Veo 3.1"]]);
  assert.ok(!JSON.stringify(c).includes("nano-banana") && !JSON.stringify(c).includes("veo3-1"), "no model ids");
  assert.deepEqual(c.usage, { spent: 0, cap: 200, remaining: 200 });
});

await check("quotes: exact credits per option; allowlist rejects unknown keys and raw model ids", async () => {
  const q = async (kind, key, withImage = false) => (await api("/api/media/quote", { kind, key, withImage })).body;
  assert.equal((await q("image", "lite")).credits, 15);
  assert.equal((await q("image", "nb2")).credits, 20);
  assert.equal((await q("video", "pixverse")).credits, 50);
  assert.equal((await q("video", "veo")).credits, 80);
  assert.equal((await q("image", "lite")).remaining, 200);
  for (const [kind, key] of [["image", "nano-banana-2"], ["image", "pixverse"], ["video", "lite"], ["audio", "lite"], ["image", "__proto__"]]) {
    const r = await api("/api/media/quote", { kind, key });
    assert.equal(r.status, 400, `${kind}/${key}`);
    assert.equal(r.body.error, "האפשרות שנבחרה לא קיימת.");
  }
});

let imageUrl = "";
await check("generate: wrong confirmed price rejected; right one starts a job; polling reaches the result", async () => {
  const wrong = await api("/api/media/generate", { kind: "image", key: "lite", prompt: "חתול על ספה", credits: 14 });
  assert.equal(wrong.status, 409);
  assert.equal(wrong.body.credits, 15);
  const g = await api("/api/media/generate", { kind: "image", key: "lite", prompt: "חתול על ספה", credits: 15 });
  assert.equal(g.status, 200, JSON.stringify(g.body));
  const job = (await state()).jobs.at(-1);
  assert.deepEqual([job.model, job.mode, job.params], ["nano-banana-2-lite", "text2image", { prompt: "חתול על ספה" }]);
  assert.equal((await api(`/api/media/status?id=${g.body.id}`)).body.status, "running");
  const done = await waitDone(g.body.id);
  assert.equal(done.body.status, "done");
  assert.match(done.body.url, /^\/media\/images\/h_[\w-]+\.png$/);
  assert.equal(done.body.credits, 15);
  imageUrl = done.body.url;
  assert.equal((await usage()).spent, 15);
});

await check("media proxy: same-origin image, video with Range, download header, no traversal", async () => {
  const img = await req(imageUrl, { cookie: friend });
  assert.equal(img.status, 200);
  assert.equal(img.headers.get("content-type"), "image/png");
  const fixture = (await import("node:fs")).readFileSync(new URL("./fixtures/sample.png", import.meta.url));
  assert.ok(Buffer.from(await img.arrayBuffer()).equals(fixture));

  const g = await api("/api/media/generate", { kind: "video", key: "pixverse", prompt: "גלים בים", credits: 50 });
  const done = await waitDone(g.body.id);
  assert.match(done.body.url, /^\/media\/videos\/.+\.webm$/);
  assert.match(done.body.poster, /^\/media\/images\//);
  const part = await req(done.body.url, { cookie: friend, headers: { Range: "bytes=0-99" } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get("content-range"), "bytes 0-99/55155");
  assert.equal((await part.arrayBuffer()).byteLength, 100);
  assert.equal(part.headers.get("accept-ranges"), "bytes");
  const dl = await req(`${done.body.url}?download=1`, { cookie: friend });
  assert.match(dl.headers.get("content-disposition"), /^attachment; filename=".+\.webm"$/);
  for (const bad of ["/media/..%2F..%2Fetc%2Fpasswd", "/media/a/../../x", "/media/%2e%2e/x"]) {
    assert.equal((await req(bad, { cookie: friend })).status, 404, bad);
  }
});

await check("image→video and image edit: uploads the reference, sends exactly startFrame / visualReferences", async () => {
  const q1 = (await api("/api/media/quote", { kind: "video", key: "pixverse", withImage: true })).body.credits;
  const g1 = await api("/api/media/generate", { kind: "video", key: "pixverse", prompt: "התמונה מתעוררת", credits: q1, image: { source: imageUrl } });
  assert.equal(g1.status, 200, JSON.stringify(g1.body));
  let job = (await state()).jobs.at(-1);
  assert.equal(job.mode, "image2video");
  assert.deepEqual(Object.keys(job.params.startFrame).sort(), ["id", "label", "type", "url"]);
  await waitDone(g1.body.id);

  const g2 = await api("/api/media/generate", { kind: "image", key: "lite", prompt: "תוסיף כובע", credits: 15, image: { dataUrl: pngDataUrl } });
  assert.equal(g2.status, 200, JSON.stringify(g2.body));
  job = (await state()).jobs.at(-1);
  assert.equal(job.mode, "image2image");
  assert.equal(job.params.visualReferences.length, 1);
  await waitDone(g2.body.id);

  const bad = await api("/api/media/generate", { kind: "image", key: "lite", prompt: "x", credits: 15, image: { source: "https://evil.example/x.png" } });
  assert.equal(bad.status, 400);
});

await check("failed and blocked generations: Hebrew errors, credits returned", async () => {
  const before = (await usage()).spent;
  const f = await api("/api/media/generate", { kind: "image", key: "lite", prompt: "זה נכשל", credits: 15 });
  assert.equal((await waitDone(f.body.id)).body.error, "היצירה נכשלה. נסו שוב.");
  const b = await api("/api/media/generate", { kind: "image", key: "lite", prompt: "תוכן חסום", credits: 15 });
  assert.equal((await waitDone(b.body.id)).body.error, "הבקשה נחסמה על ידי מסנן התוכן של OpenArt. נסו לנסח אחרת.");
  assert.equal((await usage()).spent, before, "both refunded");
});

await check("price change between quote and confirm is rejected with the new price", async () => {
  await control({ costMultiplier: 2 });
  const r = await api("/api/media/generate", { kind: "image", key: "lite", prompt: "חתול", credits: 15 });
  assert.equal(r.status, 409);
  assert.equal(r.body.credits, 30);
  assert.equal(r.body.error, "המחיר השתנה. בדקו את המחיר החדש ואשרו שוב.");
  await control({ costMultiplier: 1 });
});

await check("not enough credits in the account", async () => {
  await control({ balance: 10 });
  const r = await api("/api/media/generate", { kind: "image", key: "lite", prompt: "חתול", credits: 15 });
  assert.equal(r.status, 402);
  assert.equal(r.body.error, "אין מספיק קרדיטים בחשבון ה-OpenArt.");
  await control({ balance: 2800 });
});

await check("daily cap: refuses before starting anything once 200 credits would be passed", async () => {
  let { spent } = await usage();
  while (spent + 80 <= 200) {
    const g = await api("/api/media/generate", { kind: "video", key: "veo", prompt: "שקיעה", credits: 80 });
    assert.equal(g.status, 200);
    spent += 80;
  }
  const jobsBefore = (await state()).jobs.length;
  const over = await api("/api/media/generate", { kind: "video", key: "veo", prompt: "שקיעה", credits: 80 });
  assert.equal(over.status, 429);
  assert.equal(over.body.error, "הגעתם לתקרה היומית של 200 קרדיטים. אפשר לנסות שוב מחר.");
  assert.equal((await state()).jobs.length, jobsBefore, "no job started");
  assert.ok((await usage()).spent <= 200);
});

await check("status only for jobs this site started", async () => {
  assert.equal((await api("/api/media/status?id=h_someone_else")).status, 404);
  assert.equal((await api("/api/media/status?id=../x")).status, 404);
});

console.log("\n" + results.join("\n"));
process.exitCode = results.some((r) => r.startsWith("FAIL")) ? 1 : 0;
