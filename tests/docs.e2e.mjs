// Document upload checks at 375px and 1280px, light and dark. Needs the mock AI server, the
// OpenArt/Upstash mocks and tests/start-test-app.mjs (app on :3101). Run: node tests/docs.e2e.mjs
import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3101";
const CODE = process.env.ACCESS_CODE ?? "test-code-123";
const OUT = "test-screenshots";
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const foreign = [];
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(`PASS  ${name}`);
  } catch (e) {
    results.push(`FAIL  ${name}: ${e.message.split("\n")[0]}`);
    if (process.env.VERBOSE) console.log(e.message.split("\n").slice(0, 12).join("\n"));
  }
  console.log(results.at(-1));
};

const file = (fixture, name, mimeType) => ({ name, mimeType, buffer: fs.readFileSync(`tests/fixtures/${fixture}`) });
const FX = {
  pdf: file("doc-text.pdf", "דוח רבעוני.pdf", "application/pdf"),
  scanned: file("doc-scanned.pdf", "סריקה.pdf", "application/pdf"),
  docx: file("doc.docx", "פרוטוקול ישיבה.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
  txt: file("doc.txt", "קניות.txt", "text/plain"),
  csv: file("doc.csv", "לקוחות.csv", "text/csv"),
  mp3: { name: "שיר.mp3", mimeType: "audio/mpeg", buffer: Buffer.from("ID3 not really audio") },
  big: { name: "ענק.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(4_200_000, 0x20) },
  long: { name: "ארוך.txt", mimeType: "text/plain", buffer: Buffer.from("שורה ארוכה של טקסט במסמך.\n".repeat(12_000)) },
  png: { name: "pic.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64") },
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
    ctx.setDefaultTimeout(10_000);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.log(`  pageerror [${tag}]: ${e.message}`));
    const parseCalls = [];
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (!["data:", "blob:"].includes(u.protocol) && u.origin !== new URL(BASE).origin) foreign.push(r.url());
      if (u.pathname === "/api/parse") parseCalls.push(r.url());
    });

    const shot = async (name) => {
      await page.waitForTimeout(350);
      await page.screenshot({ path: `${OUT}/${name}-${tag}.png` });
    };
    const textarea = page.getByLabel("הודעה");
    const fileInput = page.getByTestId("doc-input");
    const chip = page.locator("form [data-testid=doc-chip]");
    const privacy = page.getByTestId("doc-privacy");
    const toast = page.locator('div[role="status"].fade-in.fixed');
    const sendBtn = page.getByRole("button", { name: "שליחה" });
    const lastAnswer = () => page.locator(".msg-in").last().locator(".md").innerText();
    const lastUser = () => page.locator(".msg-in").nth(-2);
    async function waitAnswer() {
      await page.getByRole("button", { name: "עצירה" }).waitFor({ state: "detached", timeout: 20_000 });
      await sendBtn.waitFor();
    }
    async function attach(fx) {
      await fileInput.setInputFiles(fx);
      await page.locator("form [data-testid=doc-chip][data-status=ready]").waitFor({ timeout: 15_000 });
    }
    async function ask(text) {
      await textarea.fill(text);
      await sendBtn.click();
      await waitAnswer();
    }
    async function newChat() {
      if (mobile) await page.getByRole("button", { name: "שיחה חדשה" }).first().click();
      else await page.getByRole("button", { name: "שיחה חדשה" }).first().click();
      await page.getByRole("heading", { name: "במה אפשר לעזור?" }).waitFor();
    }
    const expectToast = async (re) => {
      await toast.filter({ hasText: re }).waitFor({ timeout: 10_000 });
      await toast.waitFor({ state: "detached", timeout: 10_000 }).catch(() => {});
    };

    await page.goto(`${BASE}/?k=${CODE}`);
    await page.getByRole("heading", { name: "במה אפשר לעזור?" }).waitFor();

    await check(`[${tag}] separate pickers: images only for the image button, documents only for the document button`, async () => {
      const imageInput = page.getByTestId("image-input");
      // Each button opens its own input (no capture attribute: the file picker, not the camera).
      for (const [button, input] of [["צירוף תמונה", imageInput], ["צירוף מסמך", fileInput]]) {
        const chooser = page.waitForEvent("filechooser");
        await page.getByRole("button", { name: button }).click();
        const fc = await chooser;
        assert.equal(await fc.element().evaluate((el) => el.dataset.testid), await input.getAttribute("data-testid"), button);
      }
      assert.equal(await imageInput.getAttribute("accept"), "image/*");
      assert.equal(
        await fileInput.getAttribute("accept"),
        ".pdf,.doc,.docx,.txt,.md,.markdown,.csv,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,text/csv",
      );
      assert.ok(!(await fileInput.getAttribute("accept")).includes("image"), "no image types in the document picker");
      assert.equal(await fileInput.getAttribute("capture"), null);
      assert.equal(await imageInput.getAttribute("capture"), null);
      assert.equal(await fileInput.getAttribute("multiple"), null, "one document per message");
    });

    await check(`[${tag}] old Word (.doc): can be picked, clear Hebrew message`, async () => {
      await fileInput.setInputFiles({ name: "ישן.doc", mimeType: "application/msword", buffer: Buffer.from("old word") });
      await toast.filter({ hasText: /^קובצי Word ישנים \(\.doc\) לא נתמכים/ }).waitFor();
      await toast.waitFor({ state: "detached", timeout: 10_000 }).catch(() => {});
    });

    await check(`[${tag}] while reading: chip says so, send and suggestions wait`, async () => {
      // Hold the parse answer for a moment to see the in-between state.
      let release;
      const gate = new Promise((r) => (release = r));
      await page.route("**/api/parse", async (route) => {
        await gate;
        await route.continue();
      });
      await fileInput.setInputFiles(FX.pdf);
      const parsing = page.locator("form [data-testid=doc-chip][data-status=parsing]");
      await parsing.waitFor();
      assert.match(await parsing.innerText(), /קורא את המסמך…/);
      await textarea.fill("מה ההמלצה?");
      assert.ok(await sendBtn.isDisabled(), "send waits for the text");
      assert.ok(await page.getByRole("button", { name: "סכם", exact: true }).isDisabled());
      await shot("docs-parsing");
      release();
      await page.locator("form [data-testid=doc-chip][data-status=ready]").waitFor({ timeout: 15_000 });
      await page.unroute("**/api/parse");
      assert.ok(await sendBtn.isEnabled());
    });

    await check(`[${tag}] attached: name, size and type; privacy line; hint; suggestions`, async () => {
      assert.match(await chip.innerText(), /דוח רבעוני\.pdf[\s\S]*\d+ KB · PDF/);
      assert.equal(await privacy.innerText(), "תוכן המסמך נשלח למודל ה-AI כדי לענות עליו.");
      await textarea.fill("");
      assert.equal(await textarea.getAttribute("placeholder"), "שאלו משהו על המסמך…");
      for (const s of ["סכם", "מה הנקודות העיקריות?", "תרגם לעברית"]) await page.getByRole("button", { name: s, exact: true }).waitFor();
      await shot("docs-attached");
    });

    await check(`[${tag}] question about the PDF: the model gets its text; chip in the bubble`, async () => {
      await ask("מה ההמלצה?");
      const answer = await lastAnswer();
      assert.match(answer, /^\[מסמך: דוח רבעוני\.pdf · \d+ תווים · דוח רבעוני לדוגמה/);
      assert.match(await lastUser().getByTestId("doc-chip").innerText(), /דוח רבעוני\.pdf/);
      assert.match(await lastUser().innerText(), /מה ההמלצה\?/);
      assert.equal(await chip.count(), 0, "composer is clear again");
      assert.equal(await privacy.count(), 0);
      await shot("docs-answer");
    });

    await check(`[${tag}] follow-up without attaching again still uses the document`, async () => {
      await ask("ומה עם הרבעון הרביעי?");
      assert.match(await lastAnswer(), /^\[מסמך: דוח רבעוני\.pdf/);
    });

    await check(`[${tag}] reload keeps the document for follow-ups`, async () => {
      await page.reload();
      await page.locator(".msg-in [data-testid=doc-chip]").first().waitFor();
      await ask("תזכיר לי מה היה כתוב?");
      assert.match(await lastAnswer(), /^\[מסמך: דוח רבעוני\.pdf · \d+ תווים · דוח רבעוני לדוגמה/);
    });

    await check(`[${tag}] a new chat starts without a document`, async () => {
      await newChat();
      await ask("שלום");
      assert.doesNotMatch(await lastAnswer(), /\[מסמך:/);
    });

    await check(`[${tag}] suggestion chip on a DOCX; privacy line only the first time`, async () => {
      await newChat();
      await attach(FX.docx);
      assert.equal(await privacy.count(), 0, "already shown once");
      await page.getByRole("button", { name: "סכם", exact: true }).click();
      await waitAnswer();
      assert.match(await lastAnswer(), /^\[מסמך: פרוטוקול ישיבה\.docx · \d+ תווים · פרוטוקול ישיבת צוות/);
      assert.match(await lastUser().innerText(), /סכם/);
    });

    await check(`[${tag}] document only (no text): "סכם את המסמך"`, async () => {
      await newChat();
      await attach(FX.txt);
      await sendBtn.click();
      await waitAnswer();
      assert.match(await lastUser().innerText(), /קניות\.txt[\s\S]*סכם את המסמך/);
      assert.match(await lastAnswer(), /^\[מסמך: קניות\.txt · \d+ תווים · רשימת קניות לשבת/);
      await shot("docs-summary");
    });

    await check(`[${tag}] remove before sending: nothing of it reaches the model`, async () => {
      await newChat();
      await attach(FX.csv);
      assert.match(await chip.innerText(), /לקוחות\.csv[\s\S]*CSV/);
      await page.getByRole("button", { name: "הסרת המסמך" }).click();
      assert.equal(await chip.count(), 0);
      assert.equal(await textarea.getAttribute("placeholder"), "שאלו כל דבר…");
      await ask("מה בטבלה?");
      assert.doesNotMatch(await lastAnswer(), /\[מסמך:/);
    });

    await check(`[${tag}] unsupported type, too big, scanned: Hebrew errors`, async () => {
      await newChat();
      const before = parseCalls.length;
      await fileInput.setInputFiles(FX.mp3);
      await expectToast(/^אפשר לצרף תמונות, או מסמך מסוג PDF/);
      await fileInput.setInputFiles(FX.big);
      await expectToast(/^הקובץ גדול מדי/);
      assert.equal(parseCalls.length, before, "checked in the browser, nothing uploaded");
      await fileInput.setInputFiles(FX.scanned);
      await toast.filter({ hasText: /^נראה שזה מסמך סרוק/ }).waitFor({ timeout: 15_000 });
      await shot("docs-scanned-error");
      assert.equal(await chip.count(), 0);
    });

    await check(`[${tag}] images and a document together: the first kind stays, with a note`, async () => {
      await toast.waitFor({ state: "detached", timeout: 10_000 }).catch(() => {});
      await attach(FX.txt);
      await page.getByTestId("image-input").setInputFiles(FX.png); // then an image, from the image button
      await expectToast(/^אפשר לצרף להודעה תמונות או מסמך, לא את שניהם/);
      assert.equal(await chip.count(), 1, "the document stays");
      assert.equal(await page.getByRole("img", { name: /^תמונה מצורפת/ }).count(), 0);
      await page.getByRole("button", { name: "הסרת המסמך" }).click();
    });

    if (tag === "375-light") {
      await check(`[${tag}] long document: tells how much was read`, async () => {
        await attach(FX.long);
        assert.match(await chip.innerText(), /נקראו 100,000 מתוך [\d,]+ תווים/);
        await shot("docs-partial");
        await page.getByRole("button", { name: "הסרת המסמך" }).click();
      });

      await check(`[${tag}] daily quota on a document question: says so and points to the model picker`, async () => {
        await attach(FX.txt); // still on an empty chat here
        await textarea.fill("בדיקת מכסה יומית על המסמך"); // the mock answers with a daily-quota 429
        await sendBtn.click();
        await page.getByRole("button", { name: "עצירה" }).waitFor({ state: "detached", timeout: 20_000 });
        const alert = page.locator(".msg-in").last().getByRole("alert");
        assert.equal(await alert.innerText(), "המכסה היומית של המודל הזה נגמרה. החליפו מודל בכפתור ליד השליחה, או נסו שוב מחר.");
        await shot("docs-daily-quota");
        await fetch("http://localhost:4010/reset"); // the mock remembers the exhausted model
      });
    }

    await ctx.close();
  }
}

results.push(foreign.length ? `FAIL  requests outside our origin: ${[...new Set(foreign)].join(", ")}` : "PASS  zero browser requests outside our origin");
await browser.close();
console.log("\n" + results.join("\n"));
process.exitCode = results.some((r) => r.startsWith("FAIL")) ? 1 : 0;
