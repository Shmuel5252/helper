// Image-upload checks at 375px and 1280px, light and dark. Needs the mock server and
// tests/start-test-app.mjs (app on :3101). Run: node tests/images.e2e.mjs
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
    lastError = e.message.split("\n").slice(0, 12).join("\n");
    results.push(`FAIL  ${name}: ${e.message.split("\n")[0]}`);
  }
  console.log(results.at(-1));
  if (process.env.VERBOSE && results.at(-1).startsWith("FAIL")) console.log(lastError);
};

// Test images drawn on a canvas in the browser, returned as file payloads for setInputFiles.
async function makeFixtures(page) {
  const out = await page.evaluate(async () => {
    const draw = (w, h, colors, transparent = false) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      if (!transparent) {
        ctx.fillStyle = colors[0];
        ctx.fillRect(0, 0, w, h);
      }
      ctx.fillStyle = colors[1];
      ctx.fillRect(w * 0.1, h * 0.1, w * 0.5, h * 0.4); // marks the top-left area
      for (let i = 0; i < 400; i++) {
        ctx.fillStyle = `hsl(${(i * 37) % 360} 70% 50%)`;
        ctx.fillRect((i * 97) % w, (i * 53) % h, 12, 12);
      }
      return c;
    };
    const b64 = (blob) =>
      new Promise((r) => {
        const fr = new FileReader();
        fr.onload = () => r(fr.result.split(",")[1]);
        fr.readAsDataURL(blob);
      });
    const blob = (c, type, q) => new Promise((r) => c.toBlob(r, type, q));

    // EXIF orientation 6 (rotate 90° CW): a 300x150 landscape JPEG that must come out portrait.
    const land = await blob(draw(300, 150, ["#2563eb", "#facc15"]), "image/jpeg", 0.9);
    const bytes = new Uint8Array(await land.arrayBuffer());
    const exif = [
      0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // APP1, len 34, "Exif\0\0"
      0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // TIFF big-endian, IFD at 8
      0x00, 0x01, // one entry
      0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x06, 0x00, 0x00, // Orientation = 6
      0x00, 0x00, 0x00, 0x00, // no next IFD
    ];
    const rotated = new Uint8Array(bytes.length + exif.length);
    rotated.set(bytes.subarray(0, 2));
    rotated.set(exif, 2);
    rotated.set(bytes.subarray(2), 2 + exif.length);

    return {
      big: await b64(await blob(draw(3200, 2400, ["#0f766e", "#f97316"]), "image/jpeg", 0.95)),
      png: await b64(await blob(draw(800, 600, ["#000", "#22c55e"], true), "image/png")),
      webp: await b64(await blob(draw(900, 900, ["#7c3aed", "#fde047"]), "image/webp", 0.9)),
      rotated: await b64(new Blob([rotated])),
    };
  });
  const f = (name, mimeType, base64) => ({ name, mimeType, buffer: Buffer.from(base64, "base64") });
  return {
    big: f("big-photo.jpg", "image/jpeg", out.big),
    png: f("transparent.png", "image/png", out.png),
    webp: f("square.webp", "image/webp", out.webp),
    rotated: f("rotated.jpg", "image/jpeg", out.rotated),
    gif: { name: "anim.gif", mimeType: "image/gif", buffer: Buffer.from("R0lGODlhAQABAAAAACw=", "base64") },
    corrupt: { name: "broken.jpg", mimeType: "image/jpeg", buffer: Buffer.from("this is not a jpeg at all") },
  };
}

let fx;
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
      if (!["localhost", "127.0.0.1"].includes(u.hostname) && !["data:", "blob:"].includes(u.protocol)) external.push(r.url());
    });

    const shot = async (name) => {
      await page.waitForTimeout(350);
      await page.screenshot({ path: `${OUT}/${name}-${tag}.png` });
    };
    const textarea = page.getByLabel("הודעה");
    const attach = page.getByRole("button", { name: "צירוף תמונה" });
    const fileInput = page.locator('input[type="file"]');
    const pendingThumbs = page.getByRole("img", { name: /^תמונה מצורפת/ });
    const toast = page.locator('[role="status"].fade-in');
    const lastAnswer = () => page.locator(".msg-in").last().locator(".md").innerText();
    const lastUser = () => page.locator(".msg-in").nth(-2);
    const trigger = page.getByRole("button", { name: /^בחירת מודל/ });

    async function waitAnswer() {
      await page.getByRole("button", { name: "עצירה" }).waitFor({ state: "detached", timeout: 20000 });
      await page.getByRole("button", { name: "שליחה" }).waitFor();
    }
    async function send(text) {
      await textarea.fill(text);
      await page.getByRole("button", { name: "שליחה" }).click();
      await waitAnswer();
    }
    async function attachFiles(files, expected) {
      await fileInput.setInputFiles(files);
      await page.waitForFunction((n) => document.querySelectorAll('img[alt^="תמונה מצורפת"]').length === n, expected, {
        timeout: 15000,
      });
    }
    async function pick(label) {
      await trigger.click();
      await page.getByRole("menuitemradio", { name: new RegExp(label) }).click();
    }

    await page.goto(BASE + "/login");
    await page.fill("#code", CODE);
    await page.click("button[type=submit]");
    await page.waitForURL(BASE + "/");
    fx ??= await makeFixtures(page);

    await check(`[${tag}] attach button sits at the start (right) of the input bar`, async () => {
      await attach.waitFor();
      const a = await attach.boundingBox();
      const t = await textarea.boundingBox();
      assert.ok(a.x > t.x, "attach is right of the textarea in RTL");
    });

    await check(`[${tag}] attach 3 images, button disables, remove one`, async () => {
      await attachFiles([fx.big, fx.png, fx.webp], 3);
      assert.ok(await attach.isDisabled(), "attach disabled at 3");
      await shot("images-attached");
      await page.getByRole("button", { name: "הסרת תמונה 2" }).click();
      assert.equal(await pendingThumbs.count(), 2);
      assert.ok(await attach.isEnabled());
    });

    await check(`[${tag}] image-only send: thumbnails in the bubble, default instruction, resized ≤1600px`, async () => {
      await page.getByRole("button", { name: "שליחה" }).click();
      await waitAnswer();
      assert.equal(await lastAnswer(), "אני רואה 2 תמונות. ההוראה: תאר את התמונה");
      assert.equal(await pendingThumbs.count(), 0, "composer cleared");
      const bubble = lastUser();
      assert.equal(await bubble.getByRole("button", { name: /^הגדלת תמונה/ }).count(), 2);
      assert.equal(await bubble.locator("[dir=auto]").count(), 0, "no empty text bubble");
      const sizes = await bubble.locator("img").evaluateAll((imgs) =>
        imgs.map((i) => ({ w: i.naturalWidth, h: i.naturalHeight, kb: Math.round((i.src.length * 3) / 4 / 1024) })),
      );
      assert.equal(sizes[0].w, 1600, JSON.stringify(sizes)); // 3200x2400 → 1600x1200
      assert.equal(sizes[0].h, 1200);
      assert.ok(sizes.every((s) => s.kb < 1000), JSON.stringify(sizes));
      await shot("images-sent");
    });

    await check(`[${tag}] full-screen view opens on tap; Escape and tap close it`, async () => {
      const viewer = page.getByRole("dialog", { name: "תצוגת תמונה" });
      await lastUser().getByRole("button", { name: "הגדלת תמונה 1" }).click();
      await viewer.waitFor();
      const box = await viewer.locator("img").boundingBox();
      assert.ok(box.width > width * 0.8 || box.height > 600, `viewer image ${JSON.stringify(box)}`);
      await shot("image-viewer");
      await page.keyboard.press("Escape");
      await viewer.waitFor({ state: "detached" });
      await lastUser().getByRole("button", { name: "הגדלת תמונה 2" }).click();
      await viewer.waitFor();
      await viewer.click({ position: { x: 20, y: 300 } });
      await viewer.waitFor({ state: "detached" });
    });

    await check(`[${tag}] follow-ups still carry the latest image; older images become placeholders`, async () => {
      await send("כמה תמונות עכשיו?");
      assert.equal(await lastAnswer(), "images=2 placeholders=0");
      await attachFiles([fx.webp], 1);
      await send("ועוד אחת");
      assert.equal(await lastAnswer(), "אני רואה תמונה אחת. ההוראה: ועוד אחת");
      await send("כמה תמונות בסך הכל?");
      assert.equal(await lastAnswer(), "images=1 placeholders=1");
    });

    await check(`[${tag}] reload keeps thumbnails; storage holds thumbnails only`, async () => {
      await page.reload();
      await page.locator(".msg-in").first().waitFor();
      const imgs = page.getByRole("button", { name: /^הגדלת תמונה/ });
      assert.equal(await imgs.count(), 3);
      const w = await imgs.first().locator("img").evaluate((i) => i.naturalWidth);
      assert.ok(w <= 200, `thumbnail width ${w}`);
      const stored = await page.evaluate(() => localStorage.getItem("ai-chat:v2"));
      assert.ok(!stored.includes('"full"'), "no full images persisted");
      assert.ok(stored.length < 120_000, `store ${stored.length} chars`);
      await send("כמה תמונות אחרי רענון?");
      assert.equal(await lastAnswer(), "images=1 placeholders=1"); // thumbnail stands in for the full image
      await shot("images-after-reload");
    });

    await check(`[${tag}] non-vision option hides the attach button and sends no images`, async () => {
      await attachFiles([fx.png], 1);
      await pick("טקסט בלבד");
      assert.equal(await attach.count(), 0);
      assert.equal(await pendingThumbs.count(), 0, "pending images hidden");
      await send("כמה תמונות למודל טקסט?");
      assert.equal(await lastAnswer(), "images=0 placeholders=2");
      await shot("images-text-only-option");
      await pick("מהיר");
      assert.equal(await pendingThumbs.count(), 1, "pending image back with a vision option");
      await page.getByRole("button", { name: "הסרת תמונה 1" }).click();
    });

    if (tag === "375-light") {
      await check(`[${tag}] errors: unsupported type, unreadable file, more than 3`, async () => {
        await fileInput.setInputFiles([fx.gif]);
        await toast.filter({ hasText: "אפשר לצרף רק תמונות" }).waitFor();
        await fileInput.setInputFiles([fx.corrupt]);
        await toast.filter({ hasText: "לא הצלחנו לפתוח את התמונה" }).waitFor();
        await shot("image-error-toast");
        await fileInput.setInputFiles([fx.png, fx.webp, fx.png, fx.webp]);
        await toast.filter({ hasText: "עד 3 תמונות" }).waitFor();
        await page.waitForFunction(() => document.querySelectorAll('img[alt^="תמונה מצורפת"]').length === 3, null, {
          timeout: 15000,
        });
        for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "הסרת תמונה 1" }).click();
      });

      await check(`[${tag}] EXIF orientation is respected (landscape file tagged rotate-90 → portrait)`, async () => {
        await attachFiles([fx.rotated], 1);
        const dims = await pendingThumbs.first().evaluate((i) => [i.naturalWidth, i.naturalHeight]);
        assert.ok(dims[1] > dims[0], `thumbnail ${dims}`);
        await page.getByRole("button", { name: "הסרת תמונה 1" }).click();
      });

      await check(`[${tag}] API rejects bad images with Hebrew errors`, async () => {
        const post = (messages) =>
          page.evaluate(async (messages) => {
            const r = await fetch("/api/chat", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ messages }),
            });
            return [r.status, (await r.json().catch(() => ({}))).error];
          }, messages);
        const img = (kb, type = "jpeg") => `data:image/${type};base64,${"A".repeat(Math.ceil((kb * 1024 * 4) / 3))}`;
        const msg = (images) => [{ role: "user", content: "x", images }];
        assert.deepEqual(await post(msg([img(5), img(5), img(5), img(5)])), [400, "אפשר לצרף עד 3 תמונות להודעה."]);
        assert.deepEqual(await post(msg([img(5, "gif")])), [400, "אפשר לצרף רק תמונות מסוג JPEG, PNG או WebP."]);
        assert.deepEqual(await post(msg(["https://example.com/a.jpg"])), [400, "אפשר לצרף רק תמונות מסוג JPEG, PNG או WebP."]);
        assert.deepEqual(await post(msg([img(1100)])), [400, "אחת התמונות גדולה מדי. נסו תמונה אחרת."]);
        const [status, error] = await post([
          { role: "user", content: "a", images: [img(900), img(900), img(900)] },
          { role: "assistant", content: "b" },
          { role: "user", content: "c", images: [img(900), img(900)] },
        ]);
        assert.equal(status, 413);
        assert.match(error, /גדולות מדי לשליחה/);
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
