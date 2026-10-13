// In-memory stand-in for Upstash Redis's REST API (POST a JSON command array, get {result}).
// Supports the commands the app uses: GET, SET (NX, PX, EX), DEL, INCRBY, DECRBY, EXPIRE.
// Run: node tests/mock-upstash.mjs   (port 4030, token "test")
import http from "node:http";

const PORT = Number(process.env.PORT ?? 4030);
const TOKEN = process.env.TOKEN ?? "test";
const data = new Map(); // key -> { value, expiresAt }

const live = (key) => {
  const e = data.get(key);
  if (e && e.expiresAt && e.expiresAt <= Date.now()) data.delete(key);
  return data.get(key);
};

function run([cmd, key, ...rest]) {
  switch (cmd.toUpperCase()) {
    case "GET":
      return live(key)?.value ?? null;
    case "SET": {
      const opts = rest.slice(1).map((x) => String(x).toUpperCase());
      if (opts.includes("NX") && live(key)) return null;
      let expiresAt = null;
      const px = opts.indexOf("PX");
      const ex = opts.indexOf("EX");
      if (px >= 0) expiresAt = Date.now() + Number(rest[px + 2]);
      if (ex >= 0) expiresAt = Date.now() + Number(rest[ex + 2]) * 1000;
      data.set(key, { value: String(rest[0]), expiresAt });
      return "OK";
    }
    case "DEL":
      return [key, ...rest].reduce((n, k) => n + (data.delete(k) ? 1 : 0), 0);
    case "INCRBY":
    case "DECRBY": {
      const n = Number(live(key)?.value ?? 0) + (cmd.toUpperCase() === "INCRBY" ? 1 : -1) * Number(rest[0]);
      data.set(key, { value: String(n), expiresAt: live(key)?.expiresAt ?? null });
      return n;
    }
    case "EXPIRE": {
      const e = live(key);
      if (!e) return 0;
      e.expiresAt = Date.now() + Number(rest[0]) * 1000;
      return 1;
    }
    default:
      throw new Error(`unsupported command ${cmd}`);
  }
}

http
  .createServer(async (req, res) => {
    // Test helpers: inspect raw stored values, wipe everything.
    if (req.method === "GET" && req.url.startsWith("/__dump")) {
      const key = new URL(req.url, "http://x").searchParams.get("key");
      return res.end(JSON.stringify({ value: live(key)?.value ?? null }));
    }
    if (req.method === "POST" && req.url === "/__flush") {
      data.clear();
      return res.end("ok");
    }
    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Unauthorized" }));
    }
    let raw = "";
    for await (const c of req) raw += c;
    try {
      const result = run(JSON.parse(raw));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ result }));
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  })
  .listen(PORT, () => console.log(`[upstash-mock] listening on http://localhost:${PORT}`));
