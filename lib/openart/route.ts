import "server-only";
import { hebrewMediaError } from "./media";

// Runs a media API handler; any failure becomes `{ error: <Hebrew> }` with a fitting status.
export async function respond(fn: () => Promise<unknown>): Promise<Response> {
  try {
    return Response.json(await fn(), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const err = hebrewMediaError(e);
    return Response.json({ error: err.message, ...err.extra }, { status: err.status, headers: { "Cache-Control": "no-store" } });
  }
}

export const readJson = (request: Request) => request.json().catch(() => ({}));
