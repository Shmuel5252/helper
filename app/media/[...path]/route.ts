import { CDN_URL, cdnPath } from "@/lib/openart/media";

// Serves OpenArt results from our own origin (the browser never contacts cdn.openart.ai, which
// the phone's filter may block). Streams the file, forwards Range for video seeking, and adds
// Content-Disposition for ?download. Behind the friend's access gate (proxy.ts).
async function serve(request: Request, ctx: RouteContext<"/media/[...path]">) {
  const { path } = await ctx.params;
  const p = cdnPath(`/media/${path.join("/")}`);
  if (!p) return new Response(null, { status: 404 });

  const range = request.headers.get("range");
  const upstream = await fetch(`${CDN_URL}/${p}`, {
    method: request.method === "HEAD" ? "HEAD" : "GET",
    headers: range ? { Range: range } : {},
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!upstream || (!upstream.ok && upstream.status !== 206)) {
    return new Response(null, { status: upstream?.status === 416 ? 416 : 404 });
  }

  const headers = new Headers({ "Cache-Control": "private, max-age=86400", "Accept-Ranges": "bytes" });
  for (const k of ["content-type", "content-range", "etag", "last-modified"]) {
    const v = upstream.headers.get(k);
    if (v) headers.set(k, v);
  }
  // fetch() decodes compressed bodies, so a length is only accurate for uncompressed ones.
  const len = upstream.headers.get("content-length");
  if (len && !upstream.headers.get("content-encoding")) headers.set("Content-Length", len);
  if (new URL(request.url).searchParams.has("download")) {
    headers.set("Content-Disposition", `attachment; filename="${p.split("/").pop()}"`);
  }
  return new Response(request.method === "HEAD" ? null : upstream.body, { status: upstream.status, headers });
}

export { serve as GET, serve as HEAD };
