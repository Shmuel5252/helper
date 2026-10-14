import { DOC_ERRORS, DOC_MAX_BYTES, docType, type DocAttachment } from "@/lib/documents";
import { parseDocument, ParseError } from "@/lib/parseDocument";

export const maxDuration = 30;

const fail = (status: number, error: string) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

// Multipart { file } → the document's text for the chat (nothing is stored on the server).
// Logs carry only the type, size and page/character counts, never the text or the file name.
export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > DOC_MAX_BYTES + 64_000) return fail(413, DOC_ERRORS.size);
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return fail(400, DOC_ERRORS.type);
  const type = docType(file.name, file.type);
  if (!type) return fail(415, DOC_ERRORS.type);
  if (file.size > DOC_MAX_BYTES) return fail(413, DOC_ERRORS.size);

  const t0 = Date.now();
  try {
    const parsed = await parseDocument(type, Buffer.from(await file.arrayBuffer()));
    console.log(`Document parsed: type=${type} bytes=${file.size} pages=${parsed.pages ?? "-"} chars=${parsed.chars} used=${parsed.text.length} ms=${Date.now() - t0}`);
    const doc: DocAttachment = { name: file.name.slice(0, 200), type, size: file.size, ...parsed };
    return Response.json(doc, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const known = e instanceof ParseError;
    console.error(`Document parse failed: type=${type} bytes=${file.size} reason=${known ? (e.message === DOC_ERRORS.scanned ? "scanned" : e.message === DOC_ERRORS.empty ? "empty" : "invalid") : (e as Error)?.name}`);
    return fail(422, known ? e.message : DOC_ERRORS.failed);
  }
}
