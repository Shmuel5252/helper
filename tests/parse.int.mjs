// /api/parse against the built app (tests/start-test-app.mjs on :3101; no other mocks needed).
// Each document type, the scanned-PDF path, limits, auth, and that no document text is logged.
// Run: node tests/parse.int.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3101";
const FX = "tests/fixtures";
const LOG = path.join(os.tmpdir(), `ai-chat-app-${new URL(BASE).port || "3101"}.log`);
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

const login = await fetch(`${BASE}/?k=${process.env.ACCESS_CODE ?? "test-code-123"}`, { redirect: "manual" });
const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
const logStart = fs.existsSync(LOG) ? fs.statSync(LOG).size : 0;

async function parse(name, bytes, type = "", { auth = true } = {}) {
  const form = new FormData();
  form.append("file", new File([bytes], name, { type }));
  const res = await fetch(`${BASE}/api/parse`, { method: "POST", body: form, headers: auth ? { Cookie: cookie } : {} });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const fixture = (f) => fs.readFileSync(`${FX}/${f}`);

await check("needs the access cookie", async () => {
  const r = await parse("doc.txt", fixture("doc.txt"), "text/plain", { auth: false });
  assert.equal(r.status, 401);
});

await check("PDF with text: both pages, Hebrew in reading order, English too", async () => {
  const r = await parse("דוח רבעוני.pdf", fixture("doc-text.pdf"), "application/pdf");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.type, "pdf");
  assert.equal(r.body.pages, 2);
  assert.equal(r.body.name, "דוח רבעוני.pdf");
  assert.match(r.body.text, /דוח רבעוני לדוגמה/);
  assert.match(r.body.text, /המלצה: להמשיך את הקמפיין/);
  assert.match(r.body.text, /Quarterly report: revenue grew 12%/);
  assert.equal(r.body.chars, r.body.text.length);
});

await check("scanned PDF (no text layer): Hebrew error, no OCR", async () => {
  const r = await parse("scan.pdf", fixture("doc-scanned.pdf"), "application/pdf");
  assert.equal(r.status, 422);
  assert.match(r.body.error, /^נראה שזה מסמך סרוק/);
});

await check("DOCX: paragraphs, tab, entity, table; deleted tracked change left out", async () => {
  const r = await parse("פרוטוקול.docx", fixture("doc.docx"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.type, "docx");
  assert.match(r.body.text, /^פרוטוקול ישיבת צוות\n/);
  assert.match(r.body.text, /נוכחים: דנה, יוסי & רונית/);
  assert.match(r.body.text, /סעיף\tהחלטה/);
  assert.match(r.body.text, /הוחלט לדחות את ההשקה לחודש הבא\./);
  assert.doesNotMatch(r.body.text, /טקסט שנמחק/);
  assert.match(r.body.text, /משימה\nאחראי\nעדכון האתר\nיוסי/);
  assert.match(r.body.text, /Next meeting: Sunday$/);
});

await check("TXT and Markdown as UTF-8 text", async () => {
  let r = await parse("קניות.txt", fixture("doc.txt"), "text/plain");
  assert.equal(r.status, 200);
  assert.equal(r.body.text, "רשימת קניות לשבת:\nחלב, לחם, ביצים\nלא לשכוח פרחים.");
  r = await parse("מתכון.md", fixture("doc.md"), "");
  assert.equal(r.body.type, "md");
  assert.match(r.body.text, /^# מתכון עוגת שוקולד\n\n- 200 גרם שוקולד/);
});

await check("CSV saved by Hebrew Excel (Windows-1255) is decoded", async () => {
  const r = await parse("לקוחות.csv", fixture("doc.csv"), "text/csv");
  assert.equal(r.status, 200);
  assert.equal(r.body.text, "שם,עיר,סכום\nדנה,חיפה,120\nיוסי,אילת,85");
});

await check("long text: the model gets the first 100,000 characters, full length reported", async () => {
  const r = await parse("long.txt", Buffer.from("שורה ארוכה של טקסט.\n".repeat(16_000)), "text/plain");
  assert.equal(r.status, 200);
  assert.equal(r.body.text.length, 100_000);
  assert.ok(r.body.chars > 300_000, String(r.body.chars));
});

await check("unsupported types are refused with a Hebrew message", async () => {
  for (const [name, type] of [["old.doc", "application/msword"], ["sheet.xlsx", ""], ["tool.exe", "application/pdf"]]) {
    const r = await parse(name, Buffer.from("x"), type);
    assert.equal(r.status, 415, name);
    assert.match(r.body.error, /^אפשר לצרף תמונות, או מסמך מסוג PDF/);
  }
});

await check("too big (over 4 MB): refused before parsing", async () => {
  const r = await parse("big.txt", Buffer.alloc(4_100_000, 0x61), "text/plain");
  assert.equal(r.status, 413);
  assert.match(r.body.error, /^הקובץ גדול מדי/);
});

await check("broken files: Hebrew error, not a crash", async () => {
  for (const [name, bytes] of [
    ["fake.pdf", Buffer.from("this is not a pdf")],
    ["broken.pdf", Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog >> garbage")],
    ["broken.docx", Buffer.from("PK\u0003\u0004 not really a zip")],
    ["binary.txt", Buffer.from([0x50, 0x00, 0x01, 0x02])],
    ["empty.txt", Buffer.from("   \n  ")],
  ]) {
    const r = await parse(name, bytes);
    assert.equal(r.status, 422, name);
    assert.match(r.body.error, /^(לא הצלחנו לקרוא את המסמך|לא נמצא טקסט במסמך)/, name);
  }
});

await check("server log: type, size and counts only, never the text or the file name", async () => {
  await new Promise((r) => setTimeout(r, 300));
  const log = fs.readFileSync(LOG).subarray(logStart).toString("utf8"); // offset in bytes
  assert.match(log, /Document parsed: type=pdf bytes=\d+ pages=2 chars=\d+ used=\d+/);
  assert.match(log, /Document parse failed: type=pdf bytes=\d+ reason=scanned/);
  for (const secret of ["דוח רבעוני", "Quarterly", "פרוטוקול", "רונית", "רשימת קניות", "חיפה", "שורה ארוכה", "מתכון"])
    assert.ok(!log.includes(secret), `log contains "${secret}"`);
});

console.log("\n" + results.join("\n"));
process.exitCode = results.some((r) => r.startsWith("FAIL")) ? 1 : 0;
