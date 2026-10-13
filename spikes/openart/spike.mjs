// Feasibility spike CLI. Run from the repo root:
//   node spikes/openart/spike.mjs discover | login | tools | call <tool> '<json>' | refresh-test | revoke
// Never prints tokens. Evidence (tool schemas, call results) goes to ./.secrets/evidence/ (git-ignored).
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { Mcp } from "./mcp.mjs";
import { authorizeUrl, describe, discover, exchangeCode, fp, getClient, loadTokens, pkce, refresh, REDIRECT_URI } from "./oauth.mjs";

const EVIDENCE = path.join(import.meta.dirname, ".secrets", "evidence");
const save = (name, data) => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE, name), JSON.stringify(data, null, 2));
};
const show = (label, data) => console.log(`${label}:`, typeof data === "string" ? data : JSON.stringify(data, null, 2));

// Zero-credit guard: only read-only tools may be called from this spike.
const FORBIDDEN = /generat|create|upload|import|sign|pick|delete|update|edit|run|submit|start|enhance|upscale/i;

async function connect() {
  const { as } = await discover();
  const client = await getClient(as);
  const tokens = loadTokens();
  if (!tokens) throw new Error("not logged in: run `login` first");
  const mcp = new Mcp(as, client, tokens);
  const init = await mcp.connect();
  return { as, client, mcp, init };
}

const commands = {
  async discover() {
    const { prm, as } = await discover();
    show("protected resource metadata", prm);
    show("authorization server metadata", as);
  },

  async login() {
    const { as } = await discover();
    const client = await getClient(as);
    show("registered client", { client_id_length: client.client_id.length, token_endpoint_auth_method: client.token_endpoint_auth_method, grant_types: client.grant_types, other_fields: Object.keys(client) });
    const p = pkce();
    const url = authorizeUrl(as, client, p);
    const { port } = new URL(REDIRECT_URI);

    const code = await new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const u = new URL(req.url, REDIRECT_URI);
        if (u.pathname !== "/callback") return res.writeHead(404).end();
        const ok = u.searchParams.get("state") === p.state && u.searchParams.get("code");
        res.writeHead(ok ? 200 : 400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<p dir="rtl" style="font:20px sans-serif">${ok ? "החיבור הצליח. אפשר לסגור את החלון." : "החיבור נכשל."}</p>`);
        server.close();
        if (ok) resolve(u.searchParams.get("code"));
        else reject(new Error(`callback error: ${u.searchParams.get("error") ?? "state mismatch"} ${u.searchParams.get("error_description") ?? ""}`));
      });
      server.listen(Number(port), "127.0.0.1", () => {
        console.log(`\nOpen this URL to authorize (it contains no secrets):\n${url}\n\nWaiting for the callback on ${REDIRECT_URI} …`);
        spawn("rundll32", ["url.dll,FileProtocolHandler", url], { detached: true, stdio: "ignore" }).unref();
      });
      setTimeout(() => {
        server.close();
        reject(new Error("timed out after 15 minutes"));
      }, 15 * 60_000).unref();
    });

    const tokens = await exchangeCode(as, client, code, p.verifier);
    show("tokens received (described, not shown)", describe(tokens));
  },

  async tools() {
    const { mcp, init } = await connect();
    show("server", { protocolVersion: init.protocolVersion, serverInfo: init.serverInfo, capabilities: init.capabilities, instructions: init.instructions?.slice(0, 600) });
    const tools = await mcp.listTools();
    save("tools.json", tools);
    for (const t of tools) {
      const props = Object.keys(t.inputSchema?.properties ?? {});
      const req = t.inputSchema?.required ?? [];
      console.log(`\n• ${t.name}${FORBIDDEN.test(t.name) ? "  [spends credits / writes — never called here]" : ""}`);
      console.log(`  ${(t.description ?? "").replace(/\s+/g, " ").slice(0, 260)}`);
      console.log(`  args: ${props.map((p) => (req.includes(p) ? `${p}*` : p)).join(", ") || "(none)"}`);
    }
    console.log(`\n${tools.length} tools; full schemas in .secrets/evidence/tools.json`);
  },

  async call(name, json = "{}") {
    if (!name) throw new Error("usage: call <tool> '<json args>'");
    if (FORBIDDEN.test(name)) throw new Error(`refusing to call ${name}: this spike spends zero credits`);
    const { mcp } = await connect();
    const result = await mcp.callTool(name, JSON.parse(json));
    save(`call-${name}-${Date.now()}.json`, { args: JSON.parse(json), result });
    const text = (result.content ?? []).map((c) => (c.type === "text" ? c.text : `[${c.type}]`)).join("\n");
    console.log(text.slice(0, 6000) || JSON.stringify(result.structuredContent ?? result, null, 2).slice(0, 6000));
    if (result.isError) process.exitCode = 1;
  },

  async "refresh-test"() {
    const { as, client, mcp } = await connect();
    const before = loadTokens();
    show("before", describe(before));

    // 1. Explicit refresh, as a server would do before the access token expires.
    const { next } = await refresh(as, client);
    show("after explicit refresh", {
      ...describe(next),
      access_token_changed: fp(next.access_token) !== fp(before.access_token),
      refresh_token_rotated: fp(next.refresh_token) !== fp(before.refresh_token),
    });
    mcp.tokens = next;
    const tools = await mcp.listTools();
    console.log(`tools/list with the refreshed access token: OK (${tools.length} tools)`);

    // 2. Simulated expiry: a bad access token must trigger refresh-on-401 and a transparent retry.
    mcp.tokens = { ...loadTokens(), access_token: "expired-or-revoked" };
    const again = await mcp.listTools();
    show("after simulated expiry", {
      tools_ok: again.length,
      automatic_refreshes: mcp.refreshes,
      refresh_token_rotated_again: fp(loadTokens().refresh_token) !== fp(next.refresh_token),
      ...describe(loadTokens()),
    });
  },

  async revoke() {
    const { as } = await discover();
    const client = await getClient(as);
    const t = loadTokens();
    if (!t) return console.log("nothing to revoke");
    for (const [hint, token] of [["refresh_token", t.refresh_token], ["access_token", t.access_token]]) {
      if (!token) continue;
      const r = await fetch(as.revocation_endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token, token_type_hint: hint, client_id: client.client_id }),
      });
      console.log(`revoke ${hint}: HTTP ${r.status}`);
    }
    fs.rmSync(path.join(import.meta.dirname, ".secrets", "tokens.json"), { force: true });
  },
};

const [cmd, ...args] = process.argv.slice(2);
if (!commands[cmd]) {
  console.log(`commands: ${Object.keys(commands).join(" | ")}`);
  process.exit(1);
}
commands[cmd](...args).catch((e) => {
  console.error(`error: ${e.message}`);
  process.exitCode = 1;
});
