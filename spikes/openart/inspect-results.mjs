// Read-only: how are finished results delivered? Looks at up to 3 past generations and reports
// only the URL shape (host, signed/expiring query params) and whether it loads without auth.
import { Mcp } from "./mcp.mjs";
import { discover, getClient, loadTokens } from "./oauth.mjs";

const { as } = await discover();
const mcp = new Mcp(as, await getClient(as), loadTokens());
await mcp.connect();
const r = await mcp.callTool("openart_creation_list", { limit: 3 });
const data = r.structuredContent ?? JSON.parse(r.content.find((c) => c.type === "text")?.text ?? "{}");
const items = data.items ?? data.creations ?? data.histories ?? [];
console.log(`creations returned: ${items.length}; top-level fields: ${Object.keys(data).join(", ")}`);
for (const it of items) {
  for (const res of it.resources ?? [it]) { // list items carry url/thumbnailUrl directly
    for (const [kind, url] of [["url", res.url], ["thumbnailUrl", res.thumbnailUrl]]) {
      if (!url) continue;
      const u = new URL(url);
      const head = await fetch(url, { method: "HEAD" }); // no Authorization header
      console.log({
        mediaType: res.mediaType,
        kind,
        host: u.host,
        pathExt: u.pathname.split(".").pop(),
        queryParams: [...u.searchParams.keys()],
        unauthenticatedHead: head.status,
        contentType: head.headers.get("content-type"),
        cacheControl: head.headers.get("cache-control"),
        expiresHeader: head.headers.get("expires"),
      });
    }
  }
}
