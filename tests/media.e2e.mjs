// Image/video generation UI at 375px and 1280px, light and dark, against the OpenArt and
// Upstash mocks. Needs: mock-openart, mock-upstash, mock-nvidia and tests/start-test-app.mjs.
// Run: node tests/media.e2e.mjs
import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3101";
const OA = "http://localhost:4020";
const KV = process.env.TEST_KV_URL ?? "http://localhost:4030";
const CODE = "test-code-123";
const OUT = "test-screenshots";
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const foreign = [];
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

const control = (c) => fetch(`${OA}/__control`, { method: "POST", body: JSON.stringify(c) });
const oaState = () => fetch(`${OA}/__state`).then((r) => r.json());
const kv = (...cmd) =>
  fetch(KV, { method: "POST", headers: { Authorization: "Bearer test" }, body: JSON.stringify(cmd) }).then((r) => r.json());
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(Date.now());
const cookieOf = (res) => (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");

// Connects the app to the mock OpenArt account, as the owner would on /admin/openart.
async function connectOwner() {
  const admin = cookieOf(await fetch(`${BASE}/api/admin/login`, { method: "POST", redirect: "manual", body: new URLSearchParams({ code: "admin-test" }) }));
  const start = await fetch(`${BASE}/api/admin/openart/connect`, { method: "POST", redirect: "manual", headers: { Cookie: admin } });
  const approved = await fetch(start.headers.get("location"), { redirect: "manual" });
  await fetch(approved.headers.get("location"), { redirect: "manual", headers: { Cookie: admin } });
  return admin;
}

await control({ reset: true });
await fetch("http://localhost:4010/reset"); // no AI model left out of quota by other suites
await fetch(`${KV}/__flush`, { method: "POST" });
const adminCookie = await connectOwner();

for (const width of [375, 1280]) {
  for (const scheme of ["light", "dark"]) {
    const mobile = width < 1024;
    const tag = `${width}-${scheme}`;
    if (process.env.ONLY && process.env.ONLY !== tag) continue;
    await kv("DEL", `openart:spent:${today}`); // each config starts with a fresh daily budget
    const ctx = await browser.newContext({
      viewport: { width, height: mobile ? 812 : 860 },
      deviceScaleFactor: 2,
      isMobile: mobile,
      hasTouch: mobile,
      colorScheme: scheme,
      locale: "he-IL",
    });
    ctx.setDefaultTimeout(10_000);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.log(`  pageerror [${tag}]: ${e.message}`));
    const generateCalls = [];
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (!["data:", "blob:"].includes(u.protocol) && u.origin !== new URL(BASE).origin) foreign.push(r.url());
      if (u.pathname === "/api/media/generate") generateCalls.push(r.url());
    });

    const shot = async (name) => {
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/${name}-${tag}.png` });
    };
    const textarea = page.getByLabel("הודעה");
    const info = page.getByTestId("media-info");
    const understood = page.getByLabel("כך הבנו את הבקשה");
    const radio = (name) => page.getByRole("radio", { name });
    const goButton = page.locator("form button[type=submit]");
    const lastCard = () => page.locator("[data-media-status]").last();
    const waitCard = (status, timeout = 15_000) =>
      page.waitForFunction((s) => [...document.querySelectorAll("[data-media-status]")].at(-1)?.dataset.mediaStatus === s, status, { timeout });
    async function confirmAndGo() {
      await goButton.click(); // first tap arms
      await page.waitForFunction(() => document.querySelector("form button[type=submit]")?.dataset.confirming === "true");
      await goButton.click(); // second tap spends
    }

    await page.goto(`${BASE}/?k=${CODE}`);
    await page.getByRole("heading", { name: "במה אפשר לעזור?" }).waitFor();

    await check(`[${tag}] mode switch sits next to the attach button; image mode changes the composer`, async () => {
      await radio("תמונה").waitFor();
      const sw = await page.getByRole("radiogroup", { name: "מה ליצור" }).boundingBox();
      const at = await page.getByRole("button", { name: /^צירוף (תמונה|קובץ)$/ }).boundingBox();
      assert.ok(at.x > sw.x && at.x - (sw.x + sw.width) < 14, "attach right next to the switch (RTL)");
      await radio("תמונה").click();
      assert.equal(await radio("תמונה").getAttribute("aria-checked"), "true");
      assert.equal(await textarea.getAttribute("placeholder"), "תארו את התמונה…");
      await page.getByRole("heading", { name: "איזו תמונה ליצור?" }).waitFor();
      assert.match(await page.getByRole("button", { name: /^בחירת מודל/ }).innerText(), /חסכוני/);
      await page.waitForFunction(() => /15 קרדיטים · נותרו היום 200 מתוך 200/.test(document.querySelector("[data-testid=media-info]")?.textContent ?? ""));
    });

    await check(`[${tag}] two taps to spend: the first only arms, editing the text disarms`, async () => {
      await textarea.fill("חתול כתום על ספה");
      assert.match(await goButton.getAttribute("aria-label"), /^יצירה · 15 קרדיטים$/);
      await goButton.click();
      await page.waitForFunction(() => document.querySelector("form button[type=submit]")?.dataset.confirming === "true");
      assert.match(await info.innerText(), /הקישו שוב לאישור/);
      assert.equal(generateCalls.length, 0, "nothing spent on the first tap");
      // The chat model's English reading, cleaned of its preamble, quotes and <think>.
      assert.equal(await understood.inputValue(), "EN(image) mock-text: חתול כתום על ספה");
      assert.equal(await understood.getAttribute("dir"), "auto");
      await shot("media-confirm");
      await textarea.fill("חתול כתום על ספה ירוקה");
      assert.equal(await goButton.getAttribute("data-confirming"), null, "changed text disarms");
      assert.equal(await understood.count(), 0, "and hides the old reading");
    });

    await check(`[${tag}] image result: progress card, then the image from our own domain, label with cost`, async () => {
      await goButton.click();
      await understood.waitFor();
      await understood.fill("An orange cat sleeping on a green sofa, soft window light"); // the user fixes the reading
      assert.equal(await goButton.getAttribute("data-confirming"), "true", "editing the English keeps it armed");
      await goButton.click();
      await waitCard("pending");
      assert.match(await lastCard().innerText(), /יוצר תמונה…/);
      await waitCard("done");
      const src = await lastCard().locator("img").getAttribute("src");
      assert.match(src, /^\/media\/images\/.+\.png$/);
      await page.waitForFunction(() => document.querySelector("[data-media-status=done] img")?.naturalWidth > 0);
      assert.equal(await lastCard().getByTestId("media-label").innerText(), "תמונה · חסכוני · 15 קרדיטים");
      assert.equal(generateCalls.length, 1);
      assert.equal((await oaState()).jobs.at(-1).params.prompt, "An orange cat sleeping on a green sofa, soft window light");
      const saved = JSON.parse(await page.evaluate(() => localStorage.getItem("ai-chat:v2")));
      const media = saved.conversations[0].messages.find((m) => m.media)?.media;
      assert.equal(media?.prompt, "חתול כתום על ספה ירוקה");
      assert.equal(media?.englishPrompt, "An orange cat sleeping on a green sofa, soft window light");
      await shot("media-image");
    });

    await check(`[${tag}] today's credits in the sidebar footer`, async () => {
      if (mobile) await page.getByRole("button", { name: "היסטוריית שיחות" }).click();
      await page.waitForFunction(() => /קרדיטים היום: 15 מתוך 200/.test(document.querySelector("[data-testid=credit-usage]")?.textContent ?? ""));
      if (mobile) {
        await shot("media-sidebar-usage");
        await page.keyboard.press("Escape");
      }
    });

    await check(`[${tag}] tapping the image opens the full-screen viewer`, async () => {
      await lastCard().getByRole("button", { name: "הגדלת התמונה" }).click();
      const viewer = page.getByRole("dialog", { name: "תצוגת תמונה" });
      await viewer.waitFor();
      assert.match(await viewer.locator("img").getAttribute("src"), /^\/media\//);
      await page.keyboard.press("Escape");
      await viewer.waitFor({ state: "detached" });
    });

    await check(`[${tag}] "הפוך לסרטון": video mode with the image as start frame; plays inline`, async () => {
      await lastCard().getByRole("button", { name: "הפוך לסרטון" }).click();
      assert.equal(await radio("סרטון").getAttribute("aria-checked"), "true");
      assert.match(await page.getByRole("img", { name: "תמונה מצורפת 1" }).getAttribute("src"), /^\/media\/images\//);
      assert.equal(await textarea.getAttribute("placeholder"), "איך להניע את התמונה? (לא חובה)");
      await page.waitForFunction(() => /^50 קרדיטים/.test(document.querySelector("[data-testid=media-info]")?.textContent ?? ""));
      await confirmAndGo(); // empty text is fine for animating an image
      await waitCard("pending");
      assert.match(await lastCard().innerText(), /יוצר סרטון… זה יכול לקחת כמה דקות/);
      await waitCard("done", 20_000);
      const job = (await oaState()).jobs.at(-1);
      assert.equal(job.mode, "image2video");
      const video = lastCard().locator("video");
      assert.match(await video.getAttribute("src"), /^\/media\/videos\/.+\.webm$/);
      assert.match(await video.getAttribute("poster"), /^\/media\/images\//);
      assert.equal(await video.getAttribute("playsinline"), "");
      await video.evaluate((v) => {
        v.muted = true;
        return v.play();
      });
      await page.waitForFunction(() => document.querySelector("[data-media-status=done] video")?.currentTime > 0.3, null, { timeout: 8000 });
      assert.equal(await lastCard().getByTestId("media-label").innerText(), "סרטון · סרטון קצר · 50 קרדיטים");
      await video.evaluate((v) => v.pause());
      await shot("media-video");
    });

    await check(`[${tag}] "ערוך": image mode with the result as reference → image edit`, async () => {
      await page.locator("[data-media-status=done]").filter({ has: page.locator("img") }).first().getByRole("button", { name: "ערוך" }).click();
      assert.equal(await radio("תמונה").getAttribute("aria-checked"), "true");
      assert.equal(await textarea.getAttribute("placeholder"), "מה לשנות בתמונה?");
      await textarea.fill("תוסיף לחתול כובע");
      await page.waitForFunction(() => /^15 קרדיטים/.test(document.querySelector("[data-testid=media-info]")?.textContent ?? ""));
      await confirmAndGo();
      await waitCard("done");
      assert.equal((await oaState()).jobs.at(-1).mode, "image2image");
    });

    await check(`[${tag}] cancel stops following; resume picks it up again`, async () => {
      await radio("סרטון").click();
      await textarea.fill("שקיעה מעל הים");
      await page.waitForFunction(() => /^50 קרדיטים/.test(document.querySelector("[data-testid=media-info]")?.textContent ?? ""));
      await confirmAndGo();
      await waitCard("pending");
      await lastCard().getByRole("button", { name: "ביטול" }).click();
      await waitCard("stopped");
      assert.match(await lastCard().innerText(), /הפסקתם לעקוב/);
      await lastCard().getByRole("button", { name: "המשך מעקב" }).click();
      await waitCard("done", 20_000);
    });

    await check(`[${tag}] reload keeps results (same-origin URLs, no files in storage)`, async () => {
      await page.reload();
      await page.locator("[data-media-status=done]").first().waitFor();
      assert.equal(await page.locator("[data-media-status=done] img").count(), 2);
      assert.equal(await page.locator("[data-media-status=done] video").count(), 2);
      const stored = await page.evaluate(() => localStorage.getItem("ai-chat:v2"));
      assert.ok(stored.includes('"/media/') && !stored.includes("data:video") && stored.length < 60_000, `${stored.length} chars`);
    });

    await check(`[${tag}] chat mode still answers, with generations in its history as text`, async () => {
      await radio("צ׳אט").click();
      assert.equal(await textarea.getAttribute("placeholder"), "שאלו כל דבר…");
      await textarea.fill("איזה מודל ענה?");
      await page.getByRole("button", { name: "שליחה" }).click();
      await page.getByRole("button", { name: "עצירה" }).waitFor({ state: "detached", timeout: 15_000 });
      assert.match(await page.locator(".msg-in").last().innerText(), /model=mock-fast/);
    });

    await check(`[${tag}] slow translation looks alive: pending bubble, shimmer, spinner, "זה לוקח רגע…"`, async () => {
      await radio("תמונה").click();
      await textarea.fill("צב הולך לאט בגינה"); // "לאט": the mock answers after 4.5 s
      await page.waitForFunction(() => /^15 קרדיטים/.test(document.querySelector("[data-testid=media-info]")?.textContent ?? ""));
      const before = generateCalls.length;
      await goButton.click();
      const bubble = page.getByTestId("pending-prompt");
      await bubble.waitFor({ timeout: 1000 });
      assert.match(await bubble.innerText(), /צב הולך לאט בגינה[\s\S]*מנסחים…/);
      assert.equal(await textarea.inputValue(), "צב הולך לאט בגינה", "composer keeps the text");
      await page.getByTestId("interp-skeleton").waitFor({ timeout: 1000 });
      assert.equal(await page.locator(".shimmer").first().evaluate((e) => getComputedStyle(e).animationName), "shimmer");
      assert.equal(await goButton.getAttribute("aria-busy"), "true");
      assert.equal(await goButton.locator("svg").getAttribute("class").then((c) => c.includes("animate-spin")), true);
      // Busy, not faded (it may still be finishing the fade-in from when the text was typed).
      await page.waitForFunction(() => getComputedStyle(document.querySelector("form button[type=submit]")).opacity === "1", null, { timeout: 1000 });
      assert.equal(await goButton.evaluate((b) => b.className.includes("disabled:opacity")), false);
      assert.equal(await page.getByText("זה לוקח רגע…").count(), 0, "not yet");
      await page.getByText("זה לוקח רגע…").waitFor({ timeout: 4000 });
      await shot("media-enhance-slow");
      await understood.waitFor({ timeout: 10_000 });
      assert.equal(await understood.inputValue(), "EN(image) mock-text: צב הולך לאט בגינה");
      assert.equal(await page.getByText("זה לוקח רגע…").count(), 0);
      assert.match(await bubble.innerText(), /ממתין לאישור/);
      assert.equal(await goButton.getAttribute("aria-busy"), null);
      assert.equal(await goButton.getAttribute("data-confirming"), "true", "armed as before: one more tap spends");
      assert.equal(generateCalls.length, before);
      await textarea.fill("");
      assert.equal(await bubble.count(), 0, "cleared with the text");
      await radio("צ׳אט").click();
    });

    if (tag === "375-light") {
      // First tap on a new text → the reading shown in the box (and the note under it, if any).
      async function readingOf(text) {
        await textarea.fill(text);
        await page.waitForFunction(() => /^15 קרדיטים/.test(document.querySelector("[data-testid=media-info]")?.textContent ?? ""));
        await goButton.click();
        await understood.waitFor({ timeout: 25_000 });
        await page.waitForFunction(() => document.querySelector("form button[type=submit]")?.dataset.confirming === "true");
        return understood.inputValue();
      }
      const NOTE_TEMP = "שגיאה זמנית בניסוח, אז נשלח את התיאור כפי שכתבתם.";
      const NOTE_QUOTA = "המכסה היומית לניסוח נגמרה, אז נשלח את התיאור כפי שכתבתם.";

      await check(`[${tag}] translation: first model out of daily quota → the next one translates`, async () => {
        await radio("תמונה").click();
        assert.equal(await readingOf("מכסת ניסוח: ציפור על ענף"), "EN(image) mock-deep: מכסת ניסוח: ציפור על ענף");
        assert.equal(await page.getByText(/אז נשלח את התיאור/).count(), 0, "no fallback note");
      });

      await check(`[${tag}] translation: timeout, then overload (503) → the third model translates`, async () => {
        const t0 = Date.now();
        assert.equal(await readingOf("עומס: ציפור על ענף"), "EN(image) mock-fast: עומס: ציפור על ענף");
        assert.ok(Date.now() - t0 > 5500, "waited out the first model's attempt timeout");
      });

      await check(`[${tag}] translation: every model out of daily quota → original prompt, quota note`, async () => {
        const before = generateCalls.length;
        assert.equal(await readingOf("כל המכסות: מטוס מעל העננים"), "כל המכסות: מטוס מעל העננים");
        await page.getByText(NOTE_QUOTA).waitFor();
        assert.equal(generateCalls.length, before, "nothing spent");
        await shot("media-enhance-quota");
      });

      await check(`[${tag}] translation: temporary error everywhere → original prompt, "temporary" note`, async () => {
        assert.equal(await readingOf("מטוס על רקע מכסה עננים"), "מטוס על רקע מכסה עננים"); // "מכסה": 429 rate limit
        await page.getByText(NOTE_TEMP).waitFor();
        assert.equal(await goButton.getAttribute("data-confirming"), "true", "still possible to go on");
        await shot("media-enhance-fallback");
      });

      await check(`[${tag}] reduced motion: the skeleton and spinner stand still`, async () => {
        await page.emulateMedia({ reducedMotion: "reduce" });
        await textarea.fill("צב הולך לאט בגינה");
        await page.waitForFunction(() => /^15 קרדיטים/.test(document.querySelector("[data-testid=media-info]")?.textContent ?? ""));
        await goButton.click();
        const anim = await page.locator(".shimmer").first().evaluate((e) => getComputedStyle(e).animationDuration);
        const spin = await goButton.locator("svg").evaluate((e) => getComputedStyle(e).animationDuration);
        assert.equal(anim, "0.001s");
        assert.equal(spin, "0.001s");
        await understood.waitFor({ timeout: 15_000 });
        await page.emulateMedia({ reducedMotion: "no-preference" });
        await textarea.fill("");
      });

      await check(`[${tag}] cancel before the job id arrives: stays stopped, resume follows it`, async () => {
        await control({ generateDelayMs: 1500 });
        await textarea.fill("ירח מעל הרים");
        await page.waitForFunction(() => /^15 קרדיטים/.test(document.querySelector("[data-testid=media-info]")?.textContent ?? ""));
        await confirmAndGo();
        await waitCard("pending");
        await lastCard().getByRole("button", { name: "ביטול" }).click(); // generate still in flight
        await waitCard("stopped", 1000);
        await page.waitForTimeout(2500); // the id has arrived meanwhile
        assert.equal(await lastCard().getAttribute("data-media-status"), "stopped", "not followed after all");
        await control({ generateDelayMs: 0 });
        await lastCard().getByRole("button", { name: "המשך מעקב" }).click();
        await waitCard("done", 15_000);
      });

      await check(`[${tag}] blocked prompt: Hebrew error in the card, credits returned`, async () => {
        await radio("תמונה").click();
        await textarea.fill("תוכן חסום לגמרי");
        await page.waitForFunction(() => /^15 קרדיטים/.test(document.querySelector("[data-testid=media-info]")?.textContent ?? ""));
        await confirmAndGo();
        await waitCard("failed");
        assert.match(await lastCard().innerText(), /הבקשה נחסמה על ידי מסנן התוכן/);
        await shot("media-blocked");
      });

      await check(`[${tag}] price changed after the quote: rejected, new price shown`, async () => {
        await textarea.fill("כלב בפארק");
        await page.waitForFunction(() => /^15 קרדיטים/.test(document.querySelector("[data-testid=media-info]")?.textContent ?? ""));
        await control({ costMultiplier: 2 });
        await confirmAndGo();
        await waitCard("failed");
        assert.match(await lastCard().innerText(), /המחיר השתנה/);
        await page.waitForFunction(() => /^30 קרדיטים/.test(document.querySelector("[data-testid=media-info]")?.textContent ?? ""));
        await control({ costMultiplier: 1 });
      });

      await check(`[${tag}] daily cap reached: notice and no way to spend`, async () => {
        await kv("SET", `openart:spent:${today}`, "190");
        await radio("סרטון").click();
        await radio("תמונה").click(); // fresh quote with the new remaining budget
        await textarea.fill("עוד תמונה");
        await page.waitForFunction(() => /הגעתם לתקרה היומית של 200 קרדיטים/.test(document.querySelector("[data-testid=media-info]")?.textContent ?? ""));
        assert.ok(await goButton.isDisabled());
        await shot("media-cap");
        await kv("DEL", `openart:spent:${today}`);
      });

      await check(`[${tag}] connection lost: Hebrew notice, chat keeps working`, async () => {
        await fetch(`${BASE}/api/admin/openart/disconnect`, { method: "POST", redirect: "manual", headers: { Cookie: adminCookie } });
        await page.reload();
        await radio("תמונה").click();
        await page.waitForFunction(() => document.querySelector("[data-testid=media-info]")?.textContent === "יצירת תמונות וסרטונים לא זמינה כרגע.");
        assert.ok(await goButton.isDisabled());
        await shot("media-unavailable");
        await radio("צ׳אט").click();
        await textarea.fill("עדיין עובד?");
        await page.getByRole("button", { name: "שליחה" }).click();
        await page.getByRole("button", { name: "עצירה" }).waitFor({ state: "detached", timeout: 15_000 });
        assert.match(await page.locator(".msg-in").last().innerText(), /קיבלתי/);
        await connectOwner();
      });

      await check(`[${tag}] admin page: status, balance, connect/disconnect`, async () => {
        const p2 = await ctx.newPage();
        await p2.goto(`${BASE}/admin/openart`);
        await p2.fill("#code", "admin-test");
        await p2.click("button[type=submit]");
        await p2.getByTestId("openart-status").waitFor();
        assert.match(await p2.getByTestId("openart-status").innerText(), /מחובר/);
        await p2.screenshot({ path: `${OUT}/admin-openart-${tag}.png` });
        await p2.close();
      });

      await check(`[${tag}] no daily cap: price without "נותרו היום", sidebar shows usage only`, async () => {
        // As the server answers when OPENART_DAILY_CREDIT_CAP is unset (cap: null, remaining: null).
        const uncap = async (route) => {
          const res = await route.fetch();
          const body = await res.json();
          for (const o of [body, body.usage]) if (o && "cap" in o) Object.assign(o, { cap: null, remaining: null });
          await route.fulfill({ response: res, json: body });
        };
        await page.route("**/api/media/config", uncap);
        await page.route("**/api/media/quote", uncap);
        await page.reload();
        await radio("תמונה").click();
        await textarea.fill("עוד תמונה");
        await page.waitForFunction(() => document.querySelector("[data-testid=media-info]")?.textContent === "15 קרדיטים");
        assert.equal(await goButton.isDisabled(), false);
        await page.getByRole("button", { name: "היסטוריית שיחות" }).click();
        await page.waitForFunction(() => /^קרדיטים היום: \d+$/.test(document.querySelector("[data-testid=credit-usage]")?.textContent ?? ""));
        await shot("media-no-cap-sidebar");
        await page.keyboard.press("Escape");
        await page.unroute("**/api/media/config");
        await page.unroute("**/api/media/quote");
      });
    }

    await ctx.close();
  }
}

results.push(foreign.length ? `FAIL  requests outside our origin: ${[...new Set(foreign)].join(", ")}` : "PASS  zero browser requests outside our origin (media included)");
await browser.close();
console.log("\n" + results.join("\n"));
process.exitCode = results.some((r) => r.startsWith("FAIL")) ? 1 : 0;
