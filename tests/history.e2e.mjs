// Conversation-history checks at 375px and 1280px, light and dark. Same setup as tests/e2e.mjs
// (app on :3101 via tests/start-test-app.mjs, against tests/mock-nvidia.mjs). Run: node tests/history.e2e.mjs
import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3101";
const CODE = process.env.ACCESS_CODE ?? "test-code-123";
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
    lastError = e.message.split("\n").slice(0, 14).join("\n");
    results.push(`FAIL  ${name}: ${e.message.split("\n")[0]}`);
  }
  console.log(results.at(-1)); // live progress
  if (process.env.VERBOSE && results.at(-1).startsWith("FAIL")) console.log(lastError);
};

const LONG_HE = "זוהי שאלה ארוכה מאוד בעברית שנועדה לבדוק שהכותרת נחתכת יפה עם שלוש נקודות בסוף";
const LONG_EN = "This is a very long English question meant to check that the title truncates nicely";

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
      const u = new URL(r.url());
      if (!["localhost", "127.0.0.1"].includes(u.hostname)) external.push(r.url());
    });

    // Let entrance animations (180-280ms) settle so screenshots show the final state.
    const shot = async (name) => {
      await page.waitForTimeout(350);
      await page.screenshot({ path: `${OUT}/${name}-${tag}.png` });
    };
    const textarea = page.getByLabel("הודעה");
    const nav = page.locator('nav[aria-label="שיחות קודמות"]');
    const drawer = page.getByRole("dialog", { name: "היסטוריית שיחות" });
    const burger = page.getByRole("button", { name: "היסטוריית שיחות" });
    const row = (title) => nav.locator("li").filter({ hasText: title });
    const sectionOf = (title) =>
      row(title).evaluate((li) => li.closest("section").querySelector("h3").textContent);
    // Answer text only (not the copy button row / model label under it).
    const lastAnswer = () => page.locator(".msg-in").last().locator(".md, .whitespace-pre-wrap").first().innerText();
    const idle = () => page.getByRole("button", { name: "שליחה" }).waitFor();

    async function send(text) {
      await textarea.fill(text);
      await page.getByRole("button", { name: "שליחה" }).click();
      await page.getByRole("button", { name: "עצירה" }).waitFor({ state: "detached", timeout: 20000 });
      await idle();
    }
    async function openList() {
      if (mobile && !(await drawer.isVisible())) {
        await burger.click();
        await drawer.waitFor();
        await page.waitForTimeout(320); // let the slide finish before screenshots/clicks
      }
    }
    async function closeList() {
      if (mobile && (await drawer.isVisible())) {
        await page.keyboard.press("Escape");
        await drawer.waitFor({ state: "hidden" });
      }
    }
    async function select(title) {
      await openList();
      await row(title).getByRole("button").first().click();
      if (mobile) await drawer.waitFor({ state: "hidden" });
    }
    async function newChat() {
      await openList();
      await (mobile ? drawer : nav.locator("..")).getByRole("button", { name: "שיחה חדשה" }).click();
      if (mobile) await drawer.waitFor({ state: "hidden" });
      await page.getByRole("heading", { name: "במה אפשר לעזור?" }).waitFor();
    }
    async function menu(title, item) {
      await openList();
      await row(title).hover();
      await row(title).getByRole("button", { name: "אפשרויות לשיחה" }).click();
      await page.getByRole("menu").waitFor();
      if (item) await page.getByRole("menuitem", { name: item }).click();
    }

    // Seed the pre-history single-conversation key, then log in.
    await page.goto(BASE + "/login");
    await page.evaluate(() =>
      localStorage.setItem(
        "ai-chat:v1",
        JSON.stringify([
          { role: "user", content: "שאלה ישנה מהגרסה הקודמת" },
          { role: "assistant", content: "תשובה ישנה שנשמרה" },
        ]),
      ),
    );
    await page.fill("#code", CODE);
    await page.click("button[type=submit]");
    await page.waitForURL(BASE + "/");

    await check(`[${tag}] 1. old single conversation migrated, shown and listed`, async () => {
      await page.getByText("תשובה ישנה שנשמרה").waitFor();
      await openList();
      await row("שאלה ישנה מהגרסה הקודמת").waitFor();
      assert.equal(await page.evaluate(() => localStorage.getItem("ai-chat:v1")), null);
      await closeList();
    });

    await check(`[${tag}] 2. three conversations, switching shows the right content`, async () => {
      await newChat();
      await send("שיחה א עם פסקה");
      await newChat();
      await send("English conversation number two");
      await newChat();
      await send("שיחה ג עם רשימות");
      await select("שיחה א עם פסקה");
      assert.match(await lastAnswer(), /^שלום! אני עוזר אישי/);
      await select("English conversation number two");
      assert.match(await lastAnswer(), /^This is a pure English answer/);
      await select("שיחה ג עם רשימות");
      assert.match(await lastAnswer(), /חלב ולחם/);
      await openList();
      assert.equal(await nav.locator("li").count(), 4);
      assert.equal(await row("שיחה ג עם רשימות").getByRole("button").first().getAttribute("aria-current"), "true");
    });

    await check(`[${tag}] 3. rename: Enter saves, Escape cancels, empty reverts`, async () => {
      await menu("שיחה א עם פסקה", "שינוי שם");
      const input = page.getByLabel("שם השיחה");
      await input.fill("שם חדש לשיחה");
      await input.press("Enter");
      await row("שם חדש לשיחה").waitFor();
      await shot("history-renamed");

      await menu("שם חדש לשיחה", "שינוי שם");
      await input.fill("לא נשמר");
      await input.press("Escape");
      await row("שם חדש לשיחה").waitFor();
      assert.equal(await row("לא נשמר").count(), 0);
      if (mobile) assert.ok(await drawer.isVisible(), "Escape in rename must not close the drawer");

      await menu("שם חדש לשיחה", "שינוי שם");
      await input.fill("   ");
      await input.press("Enter");
      await row("שם חדש לשיחה").waitFor();
    });

    await check(`[${tag}] menu keyboard: Enter opens, arrows move, Escape closes to trigger`, async () => {
      await openList();
      const trigger = row("שם חדש לשיחה").getByRole("button", { name: "אפשרויות לשיחה" });
      await trigger.focus();
      await page.keyboard.press("Enter");
      await page.getByRole("menu").waitFor();
      const focused = () => page.evaluate(() => document.activeElement.textContent.trim());
      assert.equal(await focused(), "שינוי שם");
      await page.keyboard.press("ArrowDown");
      assert.equal(await focused(), "נעיצה");
      await page.keyboard.press("ArrowUp");
      await page.keyboard.press("ArrowUp");
      assert.equal(await focused(), "מחיקה");
      await shot("history-menu");
      await page.keyboard.press("Escape");
      await page.getByRole("menu").waitFor({ state: "detached" });
      assert.equal(await page.evaluate(() => document.activeElement.getAttribute("aria-label")), "אפשרויות לשיחה");
      if (mobile) assert.ok(await drawer.isVisible());
    });

    await check(`[${tag}] 4. pin moves to "נעוצות", unpin returns it to "היום"`, async () => {
      await menu("English conversation number two", "נעיצה");
      assert.equal(await sectionOf("English conversation number two"), "נעוצות");
      const firstSection = await nav.locator("section h3").first().textContent();
      assert.equal(firstSection, "נעוצות");
      await shot("history-pinned");
      await menu("English conversation number two", "ביטול נעיצה");
      assert.equal(await sectionOf("English conversation number two"), "היום");
      assert.equal(await nav.getByRole("heading", { name: "נעוצות" }).count(), 0);
      await menu("English conversation number two", "נעיצה"); // keep pinned for the refresh check
    });

    await check(`[${tag}] 6. refresh keeps conversations, titles, pin and active chat`, async () => {
      await closeList();
      await select("שיחה ג עם רשימות");
      await page.reload();
      await page.locator(".msg-in").first().waitFor();
      assert.match(await lastAnswer(), /חלב ולחם/);
      await openList();
      assert.equal(await nav.locator("li").count(), 4);
      assert.equal(await sectionOf("English conversation number two"), "נעוצות");
      await row("שם חדש לשיחה").waitFor();
      await closeList();
    });

    await check(`[${tag}] 7. switching during streaming aborts cleanly, keeps partial text`, async () => {
      await select("שיחה ג עם רשימות");
      await textarea.fill("עכשיו תשובה ארוך");
      await page.getByRole("button", { name: "שליחה" }).click();
      await page.waitForFunction(() => document.querySelector(".msg-in:last-child")?.textContent.length > 80);
      await select("שם חדש לשיחה");
      await idle(); // no stop button left over
      assert.match(await lastAnswer(), /^שלום! אני עוזר אישי/);
      await select("שיחה ג עם רשימות");
      const a = await lastAnswer();
      await page.waitForTimeout(700);
      assert.equal(await lastAnswer(), a, "partial answer must not keep growing");
      assert.ok(a.length > 80 && a.length < 2000, `partial length ${a.length}`);
    });

    await check(`[${tag}] 5. delete with confirm; deleting the active one opens a new chat`, async () => {
      await menu("שיחה ג עם רשימות", "מחיקה");
      await nav.getByText("למחוק את השיחה").waitFor();
      await shot("history-delete-confirm");
      await nav.getByRole("button", { name: "ביטול" }).click();
      await row("שיחה ג עם רשימות").getByRole("button").first().waitFor();

      await menu("שיחה ג עם רשימות", "מחיקה"); // the active conversation
      await nav.getByRole("button", { name: "מחיקה", exact: true }).click();
      await page.getByRole("heading", { name: "במה אפשר לעזור?" }).waitFor();
      await openList();
      assert.equal(await row("שיחה ג עם רשימות").count(), 0);
      assert.equal(await nav.locator("li").count(), 3);
      assert.equal(await nav.locator("[aria-current]").count(), 0);
      await closeList();
    });

    await check(`[${tag}] 9. long Hebrew and English titles truncate with an ellipsis`, async () => {
      await newChat();
      await send(LONG_HE);
      await newChat();
      await send(LONG_EN);
      await openList();
      for (const [text, dir] of [
        [LONG_HE.slice(0, 20), "rtl"],
        [LONG_EN.slice(0, 20), "ltr"],
      ]) {
        const span = row(text).locator("span.title");
        const m = await span.evaluate((el) => ({
          dir: getComputedStyle(el).direction,
          overflow: getComputedStyle(el).textOverflow,
          cut: el.scrollWidth > el.clientWidth,
          text: el.textContent,
          right: el.getBoundingClientRect().right,
          rowRight: el.closest("button").getBoundingClientRect().right,
        }));
        assert.equal(m.dir, dir);
        assert.equal(m.overflow, "ellipsis");
        assert.ok(m.cut, "title should overflow and be truncated");
        assert.ok(m.text.endsWith("…"));
        assert.ok(m.rowRight - m.right < 16, "title starts at the right edge of the row");
      }
      await shot("history-long-titles");
    });

    if (mobile) {
      await check(`[${tag}] 8. drawer from the right; Escape / overlay / selection close it; focus returns to ☰`, async () => {
        await closeList();
        await burger.click();
        await drawer.waitFor();
        await page.waitForTimeout(320);
        const box = await drawer.boundingBox();
        assert.ok(Math.abs(box.x + box.width - width) < 1, `drawer right edge ${box.x + box.width}`);
        assert.equal(await page.evaluate(() => document.documentElement.style.overflow), "hidden");
        assert.ok(await drawer.evaluate((el) => el.contains(document.activeElement)), "focus inside drawer");
        await shot("drawer");

        await page.keyboard.press("Escape");
        await drawer.waitFor({ state: "hidden" });
        const focusedLabel = () => page.evaluate(() => document.activeElement.getAttribute("aria-label"));
        assert.equal(await focusedLabel(), "היסטוריית שיחות");
        assert.equal(await page.evaluate(() => document.documentElement.style.overflow), "");

        await burger.click();
        await drawer.waitFor();
        await page.mouse.click(20, 400); // overlay, outside the drawer
        await drawer.waitFor({ state: "hidden" });
        assert.equal(await focusedLabel(), "היסטוריית שיחות");

        await select("שם חדש לשיחה");
        assert.equal(await focusedLabel(), "היסטוריית שיחות");
        assert.match(await lastAnswer(), /^שלום! אני עוזר אישי/);
      });
    } else {
      await check(`[${tag}] sidebar on the right, ~280px, collapses and reopens`, async () => {
        const aside = page.locator("aside");
        const box = await aside.boundingBox();
        assert.ok(Math.abs(box.x + box.width - width) < 1 && Math.abs(box.width - 280) < 1, JSON.stringify(box));
        assert.equal(await aside.getAttribute("role"), null, "no modal semantics on desktop");
        await shot("sidebar");
        await aside.getByRole("button", { name: "הסתרת רשימת השיחות" }).click();
        await aside.waitFor({ state: "hidden" });
        await shot("sidebar-collapsed");
        await burger.click();
        await aside.waitFor();
      });
    }

    if (tag === "375-light") {
      await check(`[${tag}] <think> blocks never reach the screen`, async () => {
        await newChat();
        await send("שאלה עם חשיבה");
        const a = await lastAnswer();
        assert.equal(a.trim(), "הנה התשובה, בלי החשיבה.");
      });

      await check(`[${tag}] quota: oldest unpinned conversations are pruned, toast shown`, async () => {
        // Simulate a full quota: any store write above ~current size fails.
        await page.evaluate(() => {
          const limit = localStorage.getItem("ai-chat:v2").length + 50; // the next exchange adds ~150
          const orig = Storage.prototype.setItem;
          Storage.prototype.setItem = function (k, v) {
            if (v.length > limit) throw new DOMException("full", "QuotaExceededError");
            return orig.call(this, k, v);
          };
        });
        await send("עוד שאלה אחת שתמלא את האחסון לגמרי");
        await page.getByRole("status").filter({ hasText: "האחסון התמלא" }).waitFor();
        await shot("history-quota-toast");
        await openList();
        // The pinned conversation survives; the oldest unpinned (migrated one) is gone.
        await row("English conversation number two").waitFor();
        assert.equal(await row("שאלה ישנה מהגרסה הקודמת").count(), 0);
      });
    }

    await ctx.close();
  }
}

// A fresh visitor sees the empty list state.
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: "light" });
  const page = await ctx.newPage();
  await page.goto(BASE + "/login");
  await page.fill("#code", CODE);
  await page.click("button[type=submit]");
  await page.waitForURL(BASE + "/");
  await check("empty list shows 'אין עדיין שיחות'", async () => {
    await page.getByText("אין עדיין שיחות").waitFor();
    await page.screenshot({ path: `${OUT}/sidebar-empty-1280-light.png` });
  });
  await ctx.close();
}

results.push(
  external.length
    ? `FAIL  external requests: ${[...new Set(external)].join(", ")}`
    : "PASS  zero requests to external domains",
);
await browser.close();
console.log("\n" + results.join("\n"));
process.exitCode = results.some((r) => r.startsWith("FAIL")) ? 1 : 0;
