// Generates the document fixtures (committed; rerun only to change them):
//   CHROME_PATH=... node tests/fixtures/make-doc-fixtures.mjs
// doc-text.pdf    2 pages of Hebrew + English text (Chromium print, real text layer)
// doc-scanned.pdf the same kind of page, but the text is drawn into an image: no text layer
// doc.docx        a minimal Word document (deflated zip), incl. a tab, an entity, a table and a
//                 deleted tracked change that must not appear in the text
// doc.txt / doc.md  UTF-8 · doc.csv  Windows-1255 (as Hebrew Excel saves it)
import { chromium } from "playwright";
import fs from "node:fs";
import zlib from "node:zlib";

const DIR = "tests/fixtures";

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const page = await browser.newPage();
await page.setContent(`<html dir="rtl" lang="he"><body style="font: 16px sans-serif">
  <h1>דוח רבעוני לדוגמה</h1>
  <p>המכירות ברבעון השלישי עלו ב-12 אחוזים לעומת הרבעון הקודם.</p>
  <p dir="ltr">Quarterly report: revenue grew 12% quarter over quarter.</p>
  <div style="page-break-before: always"></div>
  <h2>עמוד שני</h2>
  <p>המלצה: להמשיך את הקמפיין גם ברבעון הרביעי.</p>
</body></html>`);
fs.writeFileSync(`${DIR}/doc-text.pdf`, await page.pdf({ format: "A4" }));

// "Scanned": render the text into a canvas, then print a page that only has that image.
const png = await page.evaluate(() => {
  const c = document.createElement("canvas");
  c.width = 1200;
  c.height = 500;
  const g = c.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = "#111";
  g.font = "40px sans-serif";
  g.direction = "rtl";
  g.textAlign = "right";
  g.fillText("מסמך סרוק: אין כאן שכבת טקסט", 1150, 120);
  g.fillText("רק תמונה של עמוד", 1150, 200);
  return c.toDataURL("image/png");
});
await page.setContent(`<html><body style="margin:0"><img src="${png}" style="width:100%"></body></html>`);
fs.writeFileSync(`${DIR}/doc-scanned.pdf`, await page.pdf({ format: "A4" }));
await browser.close();

// ---- DOCX: [Content_Types].xml, _rels/.rels, word/document.xml in a deflated zip ----
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const p = (runs) => `<w:p><w:pPr><w:bidi/></w:pPr>${runs}</w:p>`;
const r = (t) => `<w:r><w:t xml:space="preserve">${t}</w:t></w:r>`;
const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W}><w:body>
${p(r("פרוטוקול ישיבת צוות"))}
${p(r("נוכחים: דנה, יוסי ") + r("&amp; רונית"))}
${p(r("סעיף") + "<w:r><w:tab/></w:r>" + r("החלטה"))}
${p(r("הוחלט לדחות את ההשקה") + '<w:del w:id="1" w:author="x"><w:r><w:delText>טקסט שנמחק</w:delText></w:r></w:del>' + r(" לחודש הבא."))}
<w:tbl><w:tr><w:tc>${p(r("משימה"))}</w:tc><w:tc>${p(r("אחראי"))}</w:tc></w:tr><w:tr><w:tc>${p(r("עדכון האתר"))}</w:tc><w:tc>${p(r("יוסי"))}</w:tc></w:tr></w:tbl>
${p(r("Next meeting: Sunday"))}
</w:body></w:document>`;
const files = {
  "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  "_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  "word/document.xml": documentXml,
};
const locals = [];
const central = [];
let offset = 0;
for (const [name, content] of Object.entries(files)) {
  const raw = Buffer.from(content, "utf8");
  const data = zlib.deflateRawSync(raw);
  const nameBuf = Buffer.from(name, "utf8");
  const crc = zlib.crc32(raw);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  locals.push(local, nameBuf, data);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(20, 4);
  cd.writeUInt16LE(20, 6);
  cd.writeUInt16LE(8, 10);
  cd.writeUInt32LE(crc, 16);
  cd.writeUInt32LE(data.length, 20);
  cd.writeUInt32LE(raw.length, 24);
  cd.writeUInt16LE(nameBuf.length, 28);
  cd.writeUInt32LE(offset, 42);
  central.push(cd, nameBuf);
  offset += 30 + nameBuf.length + data.length;
}
const cdBuf = Buffer.concat(central);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(Object.keys(files).length, 8);
eocd.writeUInt16LE(Object.keys(files).length, 10);
eocd.writeUInt32LE(cdBuf.length, 12);
eocd.writeUInt32LE(offset, 16);
fs.writeFileSync(`${DIR}/doc.docx`, Buffer.concat([...locals, cdBuf, eocd]));

fs.writeFileSync(`${DIR}/doc.txt`, "רשימת קניות לשבת:\nחלב, לחם, ביצים\nלא לשכוח פרחים.\n");
fs.writeFileSync(`${DIR}/doc.md`, "# מתכון עוגת שוקולד\n\n- 200 גרם שוקולד\n- 3 ביצים\n\nאופים 25 דקות ב-180 מעלות.\n");

// Windows-1255: ASCII as is, Hebrew letters U+05D0..U+05EA → 0xE0..0xFA.
const cp1255 = (s) => Buffer.from([...s].map((ch) => (ch >= "א" && ch <= "ת" ? 0xe0 + ch.charCodeAt(0) - 0x5d0 : ch.charCodeAt(0))));
fs.writeFileSync(`${DIR}/doc.csv`, cp1255("שם,עיר,סכום\r\nדנה,חיפה,120\r\nיוסי,אילת,85\r\n"));

for (const f of ["doc-text.pdf", "doc-scanned.pdf", "doc.docx", "doc.txt", "doc.md", "doc.csv"]) console.log(f, fs.statSync(`${DIR}/${f}`).size);
