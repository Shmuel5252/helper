// End-to-end + RTL checks. Needs the app running against tests/mock-nvidia.mjs:
//   node tests/mock-nvidia.mjs
//   ACCESS_CODE=test-code-123 AI_API_KEY=mock AI_MODEL=mock AI_BASE_URL=http://localhost:4010/v1 npx next start -p 3100
//   node tests/e2e.mjs            (CHROME_PATH=... to use an existing Chromium)
import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const CODE = process.env.ACCESS_CODE ?? "test-code-123";
const OUT = "test-screenshots";
fs.mkdirSync(OUT, { recursive: true });

const CASES = [
  ["1-hebrew-paragraph", "תכתוב לי פסקה קצרה על עצמך"],
  ["2-hebrew-ends-english-number", "איך נקראת הגרסה? תענה עם סוף אנגלית"],
  ["3-pure-english", "Answer me in English please."],
  ["4-lists", "תן לי רשימות"],
  ["5-code", "תראה לי קוד"],
];

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
};

async function newPage(colorScheme, mobile = true) {
  const ctx = await browser.newContext({
    viewport: mobile ? { width: 375, height: 812 } : { width: 1280, height: 860 },
    deviceScaleFactor: 2,
    isMobile: mobile,
    hasTouch: mobile,
    colorScheme,
    locale: "he-IL",
  });
  const page = await ctx.newPage();
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (!["localhost", "127.0.0.1"].includes(u.hostname) && u.protocol !== "data:") external.push(r.url());
  });
  return page;
}

async function login(page) {
  await page.goto(BASE + "/");
  await page.waitForURL("**/login");
  await page.fill("#code", CODE);
  await page.click("button[type=submit]");
  await page.waitForURL(BASE + "/");
  await page.getByRole("heading", { name: "במה אפשר לעזור?" }).waitFor();
}

const textarea = (p) => p.getByLabel("הודעה");
const idle = (p) => p.getByRole("button", { name: "שליחה" }).waitFor();

async function send(page, text) {
  await textarea(page).fill(text);
  await page.getByRole("button", { name: "שליחה" }).click();
  await page.getByRole("button", { name: "עצירה" }).waitFor({ state: "detached", timeout: 20000 });
  await idle(page);
}

async function newChat(page) {
  if (await page.getByRole("button", { name: "שיחה חדשה" }).isEnabled())
    await page.getByRole("button", { name: "שיחה חדשה" }).click();
  await page.getByRole("heading", { name: "במה אפשר לעזור?" }).waitFor();
}

// Geometry/direction facts about the last exchange, for RTL assertions.
const facts = (page) =>
  page.evaluate(() => {
    const msgs = [...document.querySelectorAll(".msg-in")];
    const user = msgs.at(-2).querySelector("[dir=auto]");
    const ai = msgs.at(-1);
    const block = (sel) => {
      const el = ai.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { dir: cs.direction, align: cs.textAlign, rect: el.getBoundingClientRect().toJSON() };
    };
    const ur = user.getBoundingClientRect();
    return {
      vw: innerWidth,
      user: { dir: getComputedStyle(user).direction, left: ur.left, right: ur.right },
      p: block(".md p"),
      ul: block(".md ul"),
      ol: block(".md ol"),
      li: block(".md li"),
      pre: block(".md pre"),
      inlineCode: block(".md p code"),
      preOverflow: (() => {
        const pre = ai.querySelector(".md pre");
        return pre ? getComputedStyle(pre).overflowX : null;
      })(),
    };
  });

for (const scheme of ["light", "dark"]) {
  const page = await newPage(scheme);

  if (scheme === "light") {
    await check("no cookie: / redirects to /login", async () => {
      await page.goto(BASE + "/");
      assert.match(page.url(), /\/login$/);
    });
    await check("login: wrong code shows Hebrew error", async () => {
      await page.fill("#code", "wrong");
      await page.click("button[type=submit]");
      await page.getByRole("alert").filter({ hasText: "הקוד שגוי" }).waitFor();
      await page.screenshot({ path: `${OUT}/login-error-${scheme}.png` });
    });
  }

  await login(page);
  await page.screenshot({ path: `${OUT}/empty-${scheme}.png` });

  await check(`[${scheme}] placeholder/caret side: textarea is RTL when empty`, async () => {
    const d = await textarea(page).evaluate((el) => getComputedStyle(el).direction);
    assert.equal(d, "rtl");
  });

  for (const [name, prompt] of CASES) {
    await newChat(page);
    await send(page, prompt);
    await page.screenshot({ path: `${OUT}/rtl-${name}-${scheme}.png` });
    const f = await facts(page);

    await check(`[${scheme}] ${name}: user bubble hugs the right edge`, async () => {
      assert.ok(f.vw - f.user.right < 24, `right gap ${f.vw - f.user.right}`);
    });
    if (name.startsWith("3")) {
      await check(`[${scheme}] ${name}: English renders LTR`, async () => {
        assert.equal(f.user.dir, "ltr");
        assert.equal(f.p.dir, "ltr");
      });
    } else if (name.startsWith("4")) {
      await check(`[${scheme}] ${name}: lists are RTL, markers on the right`, async () => {
        assert.equal(f.ul.dir, "rtl");
        assert.equal(f.ol.dir, "rtl");
        // padding-inline-start lands on the right: markers live in that gutter
        assert.ok(f.ul.rect.right - f.li.rect.right > 10, "indent should be on the right");
        assert.ok(Math.abs(f.ul.rect.left - f.li.rect.left) < 1);
      });
    } else if (name.startsWith("5")) {
      await check(`[${scheme}] ${name}: code block + inline code are LTR, block scrolls`, async () => {
        assert.equal(f.p.dir, "rtl");
        assert.equal(f.pre.dir, "ltr");
        assert.equal(f.pre.align, "left");
        assert.equal(f.inlineCode.dir, "ltr");
        assert.equal(f.preOverflow, "auto");
      });
    } else {
      await check(`[${scheme}] ${name}: Hebrew renders RTL`, async () => {
        assert.equal(f.user.dir, "rtl");
        assert.equal(f.p.dir, "rtl");
      });
    }
  }

  if (scheme === "light") {
    await check("stop mid-stream keeps partial answer and stops growing", async () => {
      await newChat(page);
      await textarea(page).fill("תשובה ארוך בבקשה");
      await page.getByRole("button", { name: "שליחה" }).click();
      await page.waitForFunction(() => document.querySelector(".msg-in:last-child")?.textContent.length > 80);
      await page.getByRole("button", { name: "עצירה" }).click();
      await idle(page);
      const len1 = await page.locator(".msg-in").last().textContent();
      await page.waitForTimeout(800);
      const len2 = await page.locator(".msg-in").last().textContent();
      assert.equal(len1, len2);
      assert.ok(len1.length > 80 && len1.length < 2000, `len ${len1.length}`);
      await page.screenshot({ path: `${OUT}/stopped-${scheme}.png` });
    });

    await check("refresh keeps the chat", async () => {
      await page.reload();
      await page.locator(".msg-in").first().waitFor();
      assert.equal(await page.locator(".msg-in").count(), 2);
    });

    await check("new chat resets (also after refresh)", async () => {
      await newChat(page);
      await page.reload();
      await page.getByRole("heading", { name: "במה אפשר לעזור?" }).waitFor();
      assert.equal(await page.locator(".msg-in").count(), 0);
    });

    await check("suggestion tap sends it", async () => {
      await page.getByRole("button", { name: /מתכון/ }).click();
      await page.getByRole("button", { name: "עצירה" }).waitFor({ state: "detached" });
      await idle(page);
      assert.equal(await page.locator(".msg-in").count(), 2);
    });

    await check("upstream 429 shows Hebrew error, no broken screen", async () => {
      await newChat(page);
      await send(page, "בדיקת מכסה");
      await page.getByRole("alert").filter({ hasText: "מגבלת השימוש" }).waitFor();
      await page.screenshot({ path: `${OUT}/error-429-${scheme}.png` });
    });

    await check("mobile: Enter inserts a newline instead of sending", async () => {
      await newChat(page);
      await textarea(page).fill("שורה");
      await textarea(page).press("Enter");
      assert.equal(await page.locator(".msg-in").count(), 0);
      assert.equal(await textarea(page).inputValue(), "שורה\n");
    });

    await check("textarea grows and caps at 6 lines", async () => {
      await textarea(page).fill(Array.from({ length: 12 }, (_, i) => `שורה ${i}`).join("\n"));
      const h = await textarea(page).evaluate((el) => el.getBoundingClientRect().height);
      assert.ok(h > 140 && h <= 161, `height ${h}`);
      await page.screenshot({ path: `${OUT}/textarea-6-lines-${scheme}.png` });
      await textarea(page).fill("");
    });

    await check("copy button copies the answer", async () => {
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      await send(page, "תכתוב פסקה");
      await page.getByRole("button", { name: "העתקה" }).click();
      await page.getByRole("button", { name: "הועתק" }).waitFor();
      const clip = await page.evaluate(() => navigator.clipboard.readText());
      assert.match(clip, /^שלום! אני עוזר אישי/);
    });

    await check("API without cookie returns 401", async () => {
      const r = await fetch(BASE + "/api/chat", { method: "POST", body: "{}" });
      assert.equal(r.status, 401);
    });

    // Chat-page JS actually downloaded (compressed) on a cold load.
    const fresh = await newPage("light");
    await login(fresh);
    await fresh.reload({ waitUntil: "networkidle" });
    const js = await fresh.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .filter((e) => e.name.endsWith(".js"))
        .map((e) => ({ name: e.name.split("/").pop(), kb: +(e.encodedBodySize / 1024).toFixed(1) })),
    );
    const total = js.reduce((s, e) => s + e.kb, 0);
    results.push(`INFO  chat page JS on empty load: ${total.toFixed(1)} KB compressed in ${js.length} files`);
    await send(fresh, "תראה לי קוד");
    const js2 = await fresh.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .filter((e) => e.name.endsWith(".js"))
        .reduce((s, e) => s + e.encodedBodySize / 1024, 0),
    );
    results.push(`INFO  + lazy Markdown chunk after first answer: ${(js2 - total).toFixed(1)} KB compressed`);
    await fresh.context().close();
  }

  await page.context().close();
}

// Desktop: Enter sends, Shift+Enter is a newline.
{
  const page = await newPage("light", false);
  await login(page);
  await check("desktop: Shift+Enter newline, Enter sends", async () => {
    await textarea(page).fill("שלום");
    await textarea(page).press("Shift+Enter");
    assert.equal(await textarea(page).inputValue(), "שלום\n");
    await textarea(page).press("Enter");
    await page.getByRole("button", { name: "עצירה" }).waitFor({ state: "detached" });
    await idle(page);
    assert.equal(await page.locator(".msg-in").count(), 2);
  });
  await send(page, "תן לי רשימות");
  await page.screenshot({ path: `${OUT}/desktop-light.png` });
  await page.context().close();
}

results.push(
  external.length
    ? `FAIL  external requests: ${[...new Set(external)].join(", ")}`
    : "PASS  zero requests to external domains",
);

await browser.close();
console.log(results.join("\n"));
process.exitCode = results.some((r) => r.startsWith("FAIL")) ? 1 : 0;
