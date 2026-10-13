// Model-picker checks at 375px and 1280px, light and dark. Needs the mock server and
// tests/start-test-app.mjs (app on :3101 with three test options). Run: node tests/models.e2e.mjs
import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3101";
const CODE = process.env.ACCESS_CODE ?? "test-code-123";
const MOCK = process.env.MOCK_URL ?? "http://localhost:4010";
const OUT = "test-screenshots";
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
    const current = async () => (await trigger.innerText()).trim();
    const lastAnswer = () => page.locator(".msg-in").last().locator(".md").innerText();
    const lastLabel = () => page.locator(".msg-in").last().locator('[title="המודל שענה"]').innerText();
    const drawer = page.getByRole("dialog", { name: "היסטוריית שיחות" });
    const nav = page.locator('nav[aria-label="שיחות קודמות"]');

    async function send(text) {
      await textarea.fill(text);
      await page.getByRole("button", { name: "שליחה" }).click();
      await page.getByRole("button", { name: "עצירה" }).waitFor({ state: "detached", timeout: 20000 });
      await page.getByRole("button", { name: "שליחה" }).waitFor();
    }
    async function pick(label) {
      await trigger.click();
      await menu.waitFor();
      await menu.getByRole("menuitemradio", { name: new RegExp(label) }).click();
      await menu.waitFor({ state: "detached" });
    }
    async function newChat() {
      if (mobile) {
        await page.getByRole("button", { name: "היסטוריית שיחות" }).click();
        await drawer.getByRole("button", { name: "שיחה חדשה" }).click();
      } else {
        await nav.locator("..").getByRole("button", { name: "שיחה חדשה" }).click();
      }
      await page.getByRole("heading", { name: "במה אפשר לעזור?" }).waitFor();
    }
    async function openConversation(title) {
      if (mobile) await page.getByRole("button", { name: "היסטוריית שיחות" }).click();
      await nav.locator("li").filter({ hasText: title }).getByRole("button").first().click();
      if (mobile) await drawer.waitFor({ state: "hidden" });
    }

    await fetch(`${MOCK}/reset`); // forget simulated daily-quota exhaustion from earlier runs
    await page.goto(BASE + "/login");
    await page.fill("#code", CODE);
    await page.click("button[type=submit]");
    await page.waitForURL(BASE + "/");

    await check(`[${tag}] picker shows the default option`, async () => {
      await trigger.waitFor();
      assert.equal(await current(), "מהיר");
    });

    const sendBtn = page.getByRole("button", { name: "שליחה" });
    // The chip is the send button's immediate neighbour (to its right in RTL), vertically centered.
    const assertNextToSend = async () => {
      const c = await trigger.boundingBox();
      const s = await sendBtn.boundingBox();
      const gap = c.x - (s.x + s.width);
      assert.ok(gap >= 0 && gap <= 10, `gap between send and chip: ${gap}`);
      assert.ok(Math.abs(c.y + c.height / 2 - (s.y + s.height / 2)) < 3, "chip centered with send");
      return c;
    };

    await check(`[${tag}] chip lives in the composer next to send; the header has no picker`, async () => {
      const c = await assertNextToSend();
      const form = await page.locator("form").boundingBox();
      assert.ok(c.y > form.y && c.y + c.height < form.y + form.height, "chip inside the composer");
      assert.equal(await page.locator("header").getByRole("button", { name: /^בחירת מודל/ }).count(), 0);
      const t = await textarea.boundingBox();
      if (mobile) {
        assert.ok(t.y + t.height <= c.y + 1, "textarea on its own row above the buttons");
        assert.ok(t.width > 280, `textarea width ${t.width}`);
      } else {
        assert.ok(t.x >= c.x + c.width, "single row: textarea to the right of the chip");
      }
      await shot("composer-chip");
    });

    await check(`[${tag}] long text: textarea stays wide and capped at 6 lines, chip and send stay put`, async () => {
      await textarea.fill(Array.from({ length: 12 }, (_, i) => `שורה ארוכה מספר ${i} עם עוד קצת טקסט`).join("\n"));
      const t = await textarea.boundingBox();
      assert.ok(t.height > 140 && t.height <= 161, `height ${t.height}`);
      assert.ok(t.width > (mobile ? 280 : 420), `width ${t.width}`); // desktop row also holds the chat/image/video switch
      const c = await assertNextToSend();
      assert.ok(c.y + c.height <= (mobile ? 812 : 860), "chip still on screen");
      await shot("composer-long-text");
      await textarea.fill("");
    });

    await check(`[${tag}] each option shows its model name, LTR inside the RTL row`, async () => {
      await trigger.click();
      await menu.waitFor();
      const first = menu.getByRole("menuitemradio").first();
      assert.match(await first.innerText(), /לרוב השאלות · Mock Fast/);
      const name = first.locator('span[dir="ltr"]');
      assert.equal(await name.innerText(), "Mock Fast");
      assert.equal(await name.evaluate((e) => getComputedStyle(e).direction), "ltr");
      assert.equal(await first.evaluate((e) => getComputedStyle(e).direction), "rtl");
      const names = await menu.locator('[role=menuitemradio] span[dir="ltr"]').allInnerTexts();
      assert.deepEqual(names, ["Mock Fast", "Mock Deep", "Mock Deep", "Mock Text"]);
      await page.keyboard.press("Escape");
      await menu.waitFor({ state: "detached" });
    });

    await check(`[${tag}] opens as ${mobile ? "bottom sheet" : "popover above the chip"}, current marked, keyboard + Escape`, async () => {
      await trigger.click();
      await menu.waitFor();
      await page.waitForTimeout(350); // let the slide-up / fade finish before measuring
      const box = await menu.boundingBox();
      if (mobile) {
        assert.ok(Math.abs(box.y + box.height - 812) < 1 && box.width === width, `sheet ${JSON.stringify(box)}`);
      } else {
        const t = await trigger.boundingBox();
        assert.ok(box.y + box.height <= t.y && Math.abs(box.x - t.x) < 2, `popover above the chip, aligned to its end (left) edge: ${JSON.stringify(box)} vs ${JSON.stringify(t)}`);
      }
      assert.equal(await menu.getByRole("menuitemradio", { checked: true }).innerText().then((s) => s.split("\n")[0]), "מהיר");
      const focused = () => page.evaluate(() => document.activeElement.textContent.trim().split(/\s{2,}|\n/)[0]);
      assert.match(await focused(), /^מהיר/);
      await page.keyboard.press("ArrowDown");
      assert.match(await focused(), /^מעמיק/);
      await page.keyboard.press("ArrowUp");
      await page.keyboard.press("ArrowUp");
      assert.match(await focused(), /^טקסט בלבד/);
      await shot("model-picker");
      await page.keyboard.press("Escape");
      await menu.waitFor({ state: "detached" });
      assert.equal(await page.evaluate(() => document.activeElement.getAttribute("aria-haspopup")), "menu");
    });

    await check(`[${tag}] choosing "מעמיק" sends that allowlisted entry; label under the answer`, async () => {
      await pick("מעמיק");
      assert.equal(await current(), "מעמיק");
      await send("איזה מודל ענה? שיחה ראשונה");
      assert.equal(await lastAnswer(), "model=mock-deep effort=medium");
      assert.equal(await lastLabel(), "מעמיק · Mock Deep");
    });

    await check(`[${tag}] switching mid-conversation affects only the next message`, async () => {
      await pick("מהיר");
      await send("איזה מודל עכשיו?");
      assert.equal(await lastAnswer(), "model=mock-fast effort=none");
      assert.equal(await lastLabel(), "מהיר · Mock Fast");
      const labels = await page.locator('[title="המודל שענה"]').allInnerTexts();
      assert.deepEqual(labels, ["מעמיק · Mock Deep", "מהיר · Mock Fast"]);
      await shot("model-labels");
    });

    await check(`[${tag}] reload keeps the conversation's option`, async () => {
      await pick("מעמיק");
      await page.reload();
      await trigger.waitFor();
      assert.equal(await current(), "מעמיק");
    });

    await check(`[${tag}] new chat uses the last chosen option; each conversation keeps its own`, async () => {
      await newChat();
      assert.equal(await current(), "מעמיק");
      await pick("טקסט בלבד");
      await send("איזה מודל בשיחה השנייה?");
      assert.equal(await lastAnswer(), "model=mock-text effort=none");
      await openConversation("איזה מודל ענה? שיחה ראשונה");
      assert.equal(await current(), "מעמיק");
      await newChat();
      assert.equal(await current(), "טקסט בלבד");
    });

    await check(`[${tag}] removed/unknown remembered option falls back to the default`, async () => {
      await page.evaluate(() => localStorage.setItem("ai-chat:model", "removed-option"));
      await page.reload();
      await trigger.waitFor();
      assert.equal(await current(), "מהיר");
    });

    if (tag === "375-light") {
      await check(`[${tag}] API: non-allowlisted key and raw model ids are ignored`, async () => {
        const ask = (modelKey) =>
          page.evaluate(async (modelKey) => {
            const r = await fetch("/api/chat", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ messages: [{ role: "user", content: "איזה מודל?" }], modelKey }),
            });
            return r.text();
          }, modelKey);
        assert.equal(await ask("deep"), "model=mock-deep effort=medium");
        for (const k of ["mock-deep", "gemini-3.6-pro", "nope", null, 42])
          assert.equal(await ask(k), "model=mock-fast effort=none", `key ${k}`);
      });

      await check(`[${tag}] /api/models exposes only key, label, description, vision, group`, async () => {
        const j = await page.evaluate(() => fetch("/api/models").then((r) => r.json()));
        assert.deepEqual(j.models.map((m) => m.key), ["fast", "deep", "deep2", "text"]);
        assert.deepEqual(Object.keys(j.models[0]).sort(), ["description", "group", "key", "label", "modelName", "vision"]);
        assert.ok(!JSON.stringify(j).includes("mock-"), "no model ids");
      });

      await check(`[${tag}] rate limit error suggests waiting or another option`, async () => {
        await newChat();
        await send("בדיקת מכסה");
        const alert = page.locator(".msg-in").last().getByRole("alert");
        assert.match(await alert.innerText(), /חכו דקה.*אפשרות אחרת/);
      });

      await check(`[${tag}] with a single option there is no chip and the composer is one row`, async () => {
        const OPEN = process.env.OPEN_URL ?? "http://localhost:3102"; // single-option instance, gate off
        const up = await fetch(`${OPEN}/api/models`).then((r) => r.json(), () => null);
        assert.ok(up?.models?.length === 1, `start it with: TEST_ACCESS_CODE= TEST_KV_URL= TEST_AI_MODELS='only|mock-fast|only||none|1' PORT=3102 node tests/start-test-app.mjs`);
        const p2 = await ctx.newPage();
        await p2.goto(`${OPEN}/`);
        await p2.getByRole("heading", { name: "במה אפשר לעזור?" }).waitFor();
        await p2.getByLabel("הודעה").waitFor();
        await p2.waitForTimeout(500); // the model list loads after hydration
        assert.equal(await p2.getByRole("button", { name: /^בחירת מודל/ }).count(), 0);
        const t = await p2.getByLabel("הודעה").boundingBox();
        const s = await p2.getByRole("button", { name: "שליחה" }).boundingBox();
        assert.ok(Math.abs(t.y + t.height - (s.y + s.height)) < 6, "textarea and send share one row");
        await p2.screenshot({ path: `${OUT}/composer-single-option-${tag}.png` });
        await p2.close();
      });

      await check(`[${tag}] daily quota error says so, suggests another option or tomorrow`, async () => {
        await send("בדיקת מכסה יומית");
        const alert = page.locator(".msg-in").last().getByRole("alert");
        assert.match(await alert.innerText(), /נגמרה המכסה היומית.*אפשרות אחרת.*מחר/);
        await shot("daily-quota-error");
      });
    }

    await ctx.close();
  }
}

results.push(
  external.length
    ? `FAIL  external requests: ${[...new Set(external)].join(", ")}`
    : "PASS  zero requests to external domains",
);
await browser.close();
console.log("\n" + results.join("\n"));
process.exitCode = results.some((r) => r.startsWith("FAIL")) ? 1 : 0;
