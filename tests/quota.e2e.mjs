// Daily-quota badges at 375px and 1280px, light and dark. Needs the mock server and
// tests/start-test-app.mjs (app on :3101). Run: node tests/quota.e2e.mjs
import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3101";
const MOCK = process.env.MOCK_URL ?? "http://localhost:4010";
const CODE = process.env.ACCESS_CODE ?? "test-code-123";
const OUT = "test-screenshots";
const BADGE = "נגמרה המכסה · מתחדש בעוד שעתיים"; // the mock reports a 2-hour retry delay
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const external = [];
const results = [];
let lastError = "";
const check = async (name, fn) => {
  try {
    await fn();
    results.push(`PASS  ${name}`);
  } catch (e) {
    lastError = e.message.split("\n").slice(0, 12).join("\n");
    results.push(`FAIL  ${name}: ${e.message.split("\n")[0]}`);
  }
  console.log(results.at(-1));
  if (process.env.VERBOSE && results.at(-1).startsWith("FAIL")) console.log(lastError);
};

for (const width of [375, 1280]) {
  for (const scheme of ["light", "dark"]) {
    const mobile = width < 1024;
    const tag = `${width}-${scheme}`;
    if (process.env.ONLY && process.env.ONLY !== tag) continue;
    await fetch(`${MOCK}/reset`);
    const ctx = await browser.newContext({
      viewport: { width, height: mobile ? 812 : 860 },
      deviceScaleFactor: 2,
      isMobile: mobile,
      hasTouch: mobile,
      colorScheme: scheme,
      locale: "he-IL",
    });
    ctx.setDefaultTimeout(8000);
    const page = await ctx.newPage();
    await page.clock.install(); // real time keeps flowing; lets us jump past the reset later
    page.on("pageerror", (e) => console.log(`  pageerror [${tag}]: ${e.message}`));
    page.on("request", (r) => {
      if (!["localhost", "127.0.0.1"].includes(new URL(r.url()).hostname)) external.push(r.url());
    });

    const shot = async (name) => {
      await page.waitForTimeout(350);
      await page.screenshot({ path: `${OUT}/${name}-${tag}.png` });
    };
    const textarea = page.getByLabel("הודעה");
    const trigger = page.getByRole("button", { name: /^בחירת מודל/ });
    const menu = page.getByRole("menu", { name: "בחירת מודל" });
    const option = (label) => menu.getByRole("menuitemradio", { name: new RegExp(`^${label}`) });
    const current = async () => (await trigger.innerText()).trim();
    const lastAlert = () => page.locator(".msg-in").last().getByRole("alert").innerText();

    async function send(text) {
      await textarea.fill(text);
      await page.getByRole("button", { name: "שליחה" }).click();
      await page.getByRole("button", { name: "עצירה" }).waitFor({ state: "detached", timeout: 20000 });
      await page.getByRole("button", { name: "שליחה" }).waitFor();
    }
    async function pick(label) {
      await trigger.click();
      await option(label).click();
      await menu.waitFor({ state: "detached" });
    }
    // Each option's label and full text, to check which ones carry the badge.
    async function optionNames() {
      await trigger.click();
      await menu.waitFor();
      return menu
        .getByRole("menuitemradio")
        .evaluateAll((els) => els.map((e) => ({ label: e.querySelector("span > span").textContent.trim(), text: e.textContent })));
    }
    async function closeMenu() {
      await page.keyboard.press("Escape");
      await menu.waitFor({ state: "detached" });
    }
    const badged = (opts) => opts.filter((o) => o.text.includes("נגמרה המכסה")).map((o) => o.label);
    const textOf = (opts, label) => opts.find((o) => o.label === label).text;

    await page.goto(BASE + "/login");
    await page.fill("#code", CODE);
    await page.click("button[type=submit]");
    await page.waitForURL(BASE + "/");
    await trigger.waitFor();

    await check(`[${tag}] daily 429 on the current option: message points to the picker, no automatic switch`, async () => {
      await pick("מעמיק");
      await send("בדיקת מכסה יומית");
      assert.match(await lastAlert(), /נגמרה המכסה היומית של האפשרות הזו\. בחרו אפשרות אחרת בכפתור ליד השליחה/);
      assert.equal(await current(), "מעמיק", "still on the same option");
    });

    await check(`[${tag}] header indicator and a brief highlight on the picker button`, async () => {
      assert.equal(await trigger.getAttribute("data-exhausted"), "true");
      assert.match(await trigger.getAttribute("aria-label"), /נגמרה המכסה היומית/);
      assert.equal(await trigger.locator(".attention").count(), 1);
      await shot("quota-indicator");
    });

    await check(`[${tag}] badge on every option of that quota group only (accessible name includes it)`, async () => {
      const opts = await optionNames();
      assert.deepEqual(badged(opts), ["מעמיק", "יסודי"]);
      assert.ok(textOf(opts, "מעמיק").includes(BADGE), textOf(opts, "מעמיק"));
      // The badge is part of each option's computed accessible name.
      assert.equal(await menu.getByRole("menuitemradio", { name: new RegExp(BADGE) }).count(), 2);
      await shot("quota-badges");
      await closeMenu();
    });

    await check(`[${tag}] an exhausted option stays selectable`, async () => {
      await pick("יסודי");
      assert.equal(await current(), "יסודי");
      assert.equal(await trigger.getAttribute("data-exhausted"), "true");
      await send("שוב שלום");
      assert.match(await lastAlert(), /נגמרה המכסה היומית/);
      assert.equal(await current(), "יסודי");
    });

    await check(`[${tag}] picking another option manually works and clears the header indicator`, async () => {
      // New chat: the failed turns above would otherwise be merged into the next message
      // and re-trigger the mock's quota keyword.
      if (mobile) await page.getByRole("button", { name: "שיחה חדשה" }).click();
      else await page.locator('nav[aria-label="שיחות קודמות"]').locator("..").getByRole("button", { name: "שיחה חדשה" }).click();
      await page.getByRole("heading", { name: "במה אפשר לעזור?" }).waitFor();
      await pick("מהיר");
      assert.equal(await trigger.getAttribute("data-exhausted"), null);
      await send("איזה מודל?");
      assert.equal(await page.locator(".msg-in").last().locator(".md").innerText(), "model=mock-fast effort=none");
    });

    await check(`[${tag}] per-minute 429 shows "wait a minute" and marks nothing`, async () => {
      await send("בדיקת מכסה");
      assert.match(await lastAlert(), /חכו דקה/);
      assert.deepEqual(badged(await optionNames()), ["מעמיק", "יסודי"]);
      await closeMenu();
    });

    await check(`[${tag}] badges survive a reload`, async () => {
      await page.reload();
      await trigger.waitFor();
      assert.deepEqual(badged(await optionNames()), ["מעמיק", "יסודי"]);
      await closeMenu();
    });

    await check(`[${tag}] badges disappear once the reset time passes`, async () => {
      await page.clock.fastForward("01:00:00");
      const opts = await optionNames();
      assert.ok(textOf(opts, "מעמיק").includes("נגמרה המכסה · מתחדש בעוד שעה"), textOf(opts, "מעמיק"));
      await closeMenu();
      await page.clock.fastForward("01:01:00"); // past the 2h reset; the minute tick refreshes
      assert.deepEqual(badged(await optionNames()), []);
      await closeMenu();
      assert.equal(await page.evaluate(() => localStorage.getItem("ai-chat:quota")), null);
    });

    await ctx.close();
  }
}
await fetch(`${MOCK}/reset`);

results.push(
  external.length
    ? `FAIL  external requests: ${[...new Set(external)].join(", ")}`
    : "PASS  zero requests to external domains",
);
await browser.close();
console.log("\n" + results.join("\n"));
process.exitCode = results.some((r) => r.startsWith("FAIL")) ? 1 : 0;
