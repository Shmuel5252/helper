// Access checks: magic link (/?k=<code>), 365-day cookie, wrong codes, and the open site when
// ACCESS_CODE is empty. Needs the mock server, the gated app on :3101 (tests/start-test-app.mjs)
// and, for the open-site checks, a second one: TEST_ACCESS_CODE= PORT=3102 node tests/start-test-app.mjs
import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3101";
const OPEN = process.env.OPEN_URL ?? "http://localhost:3102";
const CODE = process.env.ACCESS_CODE ?? "test-code-123";
const OUT = "test-screenshots";
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const external = [];
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
const DAY = 24 * 3600;
const chatReady = (page) => page.getByRole("heading", { name: "במה אפשר לעזור?" }).waitFor();

async function freshPage() {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  ctx.setDefaultTimeout(8000);
  const page = await ctx.newPage();
  page.on("request", (r) => {
    if (!["localhost", "127.0.0.1"].includes(new URL(r.url()).hostname)) external.push(r.url());
  });
  return page;
}

// ---- Gated site ----
{
  const page = await freshPage();

  await check("magic link logs in, strips the code from the URL, sets a 365-day cookie", async () => {
    await page.goto(`${BASE}/?k=${CODE}`);
    await chatReady(page);
    assert.equal(page.url(), `${BASE}/`);
    const cookie = (await page.context().cookies()).find((c) => c.name === "ai_chat_session");
    assert.ok(cookie && cookie.httpOnly && cookie.secure && cookie.sameSite === "Lax", JSON.stringify(cookie));
    const days = (cookie.expires - Date.now() / 1000) / DAY;
    assert.ok(days > 364 && days <= 365.01, `cookie days ${days}`);
    await page.screenshot({ path: `${OUT}/magic-link-landing-375-light.png` });
  });

  await check("already logged in: /login goes straight to the chat", async () => {
    await page.goto(`${BASE}/login`);
    await chatReady(page);
    assert.equal(page.url(), `${BASE}/`);
  });

  await page.context().close();
}
{
  const page = await freshPage();

  await check("wrong magic-link code: 1s delay, then the login page with the Hebrew error", async () => {
    const t0 = Date.now();
    await page.goto(`${BASE}/?k=wrong-code`);
    assert.ok(Date.now() - t0 >= 1000, `took ${Date.now() - t0}ms`);
    assert.equal(page.url(), `${BASE}/login?e=1`);
    await page.getByRole("alert").filter({ hasText: "הקוד שגוי" }).waitFor();
  });

  await check("magic link on /login also works and lands on the chat", async () => {
    await page.goto(`${BASE}/login?k=${CODE}`);
    await chatReady(page);
    assert.equal(page.url(), `${BASE}/`);
  });

  await page.context().close();
}

await check("without a cookie: page redirects to /login, API answers 401", async () => {
  const r = await fetch(`${BASE}/`, { redirect: "manual" });
  assert.equal(r.status, 307);
  assert.equal(new URL(r.headers.get("location"), BASE).pathname, "/login"); // may be relative
  const api = await fetch(`${BASE}/api/chat`, { method: "POST", body: "{}" });
  assert.equal(api.status, 401);
});

// ---- Open site (ACCESS_CODE empty) ----
const openUp = await fetch(`${OPEN}/login`, { redirect: "manual" }).then(() => true, () => false);
if (!openUp) results.push(`SKIP  open-site checks: nothing on ${OPEN}`);
else {
  await check("ACCESS_CODE empty: the chat opens with no login, /login redirects to it", async () => {
    const page = await freshPage();
    await page.goto(`${OPEN}/`);
    await chatReady(page);
    assert.equal(page.url(), `${OPEN}/`);
    await page.goto(`${OPEN}/login`);
    await chatReady(page);
    assert.equal(page.url(), `${OPEN}/`);
    await page.context().close();
  });

  await check("ACCESS_CODE empty: the API answers without a cookie", async () => {
    const r = await fetch(`${OPEN}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "איזה מודל?" }] }),
    });
    assert.equal(r.status, 200);
    assert.equal(await r.text(), "model=mock-fast effort=none");
  });
}

results.push(
  external.length
    ? `FAIL  external requests: ${[...new Set(external)].join(", ")}`
    : "PASS  zero requests to external domains",
);
await browser.close();
console.log("\n" + results.join("\n"));
process.exitCode = results.some((r) => r.startsWith("FAIL")) ? 1 : 0;
