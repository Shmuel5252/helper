import "server-only";
import { inflateRawSync } from "node:zlib";
import { extractText, getDocumentProxy } from "unpdf";
import { capText, DOC_ERRORS, looksScanned, type DocType } from "@/lib/documents";

// Server-side text extraction for /api/parse. PDF: unpdf (PDF.js built for serverless, no
// dependencies, no canvas). DOCX: the zip's word/document.xml read with zlib — raw text is all we
// need, so no DOCX library. TXT/MD/CSV: decoded as UTF-8, or Windows-1255 (Hebrew Excel CSVs).

export class ParseError extends Error {}

export type Parsed = { text: string; chars: number; pages?: number };

async function pdfText(bytes: Uint8Array): Promise<Parsed> {
  if (!new TextDecoder().decode(bytes.subarray(0, 1024)).includes("%PDF-")) throw new ParseError(DOC_ERRORS.failed);
  let pdf;
  try {
    pdf = await getDocumentProxy(bytes);
  } catch {
    throw new ParseError(DOC_ERRORS.failed); // corrupt, or password-protected
  }
  try {
    const { totalPages, text } = await extractText(pdf, { mergePages: true });
    if (looksScanned(text, totalPages)) throw new ParseError(DOC_ERRORS.scanned);
    return { ...capText(text), pages: totalPages };
  } finally {
    await pdf.loadingTask.destroy();
  }
}

// Reads one file out of a zip through its central directory (sizes there are always right,
// unlike local headers written with a data descriptor). No zip64: files here are < 4 MB.
export function unzipEntry(zip: Buffer, wanted: string): Buffer | null {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) return null;
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let i = 0; i < count && zip.readUInt32LE(p) === 0x02014b50; i++) {
    const method = zip.readUInt16LE(p + 10);
    const size = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const skip = nameLen + zip.readUInt16LE(p + 30) + zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    if (zip.toString("utf8", p + 46, p + 46 + nameLen) === wanted) {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + size);
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data);
      return null;
    }
    p += 46 + skip;
  }
  return null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unescapeXml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === "#" ? String.fromCodePoint(parseInt(e.slice(e[1] === "x" || e[1] === "X" ? 2 : 1), e[1] === "x" || e[1] === "X" ? 16 : 10)) : (ENTITIES[e] ?? m),
  );

// word/document.xml → text: runs (<w:t>), tabs, line breaks and paragraph ends. Deleted
// tracked changes (<w:delText>) are left out, like Word's own "plain text" save.
export function docxXmlText(xml: string): string {
  let out = "";
  for (const m of xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:(tab|br|cr)\b[^>]*\/>|<\/w:p>/g)) {
    if (m[1] !== undefined) out += unescapeXml(m[1]);
    else if (m[2] === "tab") out += "\t";
    else out += "\n";
  }
  return out;
}

function docxText(bytes: Buffer): Parsed {
  let xml: Buffer | null = null;
  try {
    xml = unzipEntry(bytes, "word/document.xml");
  } catch {
    // truncated or corrupt zip
  }
  if (!xml) throw new ParseError(DOC_ERRORS.failed);
  return capText(docxXmlText(xml.toString("utf8")));
}

export function decodeText(bytes: Uint8Array): string {
  if (bytes.subarray(0, 8000).includes(0)) throw new ParseError(DOC_ERRORS.failed); // binary, not text
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes); // also drops a BOM
  } catch {
    return new TextDecoder("windows-1255").decode(bytes);
  }
}

export async function parseDocument(type: DocType, bytes: Buffer): Promise<Parsed> {
  const parsed =
    type === "pdf" ? await pdfText(new Uint8Array(bytes)) : type === "docx" ? docxText(bytes) : capText(decodeText(bytes));
  if (!parsed.text) throw new ParseError(DOC_ERRORS.empty);
  return parsed;
}
