// Minimal MCP client over Streamable HTTP (JSON-RPC over POST; replies as JSON or SSE),
// with one automatic token refresh on 401. No SDK, no dependencies.
import { MCP_URL, refresh } from "./oauth.mjs";

export class Mcp {
  constructor(as, client, tokens) {
    Object.assign(this, { as, client, tokens, sessionId: null, nextId: 1, protocol: "2025-06-18", refreshes: 0 });
  }

  async #post(payload, { retry = true } = {}) {
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${this.tokens.access_token}`,
      "MCP-Protocol-Version": this.protocol,
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
    const res = await fetch(MCP_URL, { method: "POST", headers, body: JSON.stringify(payload) });

    if (res.status === 401 && retry) {
      // Expired or revoked access token: refresh once and replay the request.
      this.tokens = (await refresh(this.as, this.client)).next;
      this.refreshes++;
      return this.#post(payload, { retry: false });
    }
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;
    if (res.status === 202 || payload.id === undefined) return null; // notification accepted

    const type = res.headers.get("content-type") ?? "";
    const text = await res.text();
    if (!res.ok) throw new Error(`MCP HTTP ${res.status}: ${text.slice(0, 300)}`);
    const messages = type.includes("text/event-stream")
      ? text
          .split(/\r?\n/)
          .filter((l) => l.startsWith("data:"))
          .map((l) => JSON.parse(l.slice(5)))
      : [JSON.parse(text)];
    const reply = messages.find((m) => m.id === payload.id);
    if (!reply) throw new Error(`no JSON-RPC reply for id ${payload.id}`);
    if (reply.error) throw new Error(`MCP error ${reply.error.code}: ${reply.error.message}`);
    return reply.result;
  }

  request(method, params = {}) {
    return this.#post({ jsonrpc: "2.0", id: this.nextId++, method, params });
  }

  async connect() {
    const init = await this.request("initialize", {
      protocolVersion: this.protocol,
      capabilities: {},
      clientInfo: { name: "ai-chat-spike", version: "0.0.1" },
    });
    this.protocol = init.protocolVersion ?? this.protocol;
    await this.#post({ jsonrpc: "2.0", method: "notifications/initialized" });
    return init;
  }

  async listTools() {
    const tools = [];
    let cursor;
    do {
      const r = await this.request("tools/list", cursor ? { cursor } : {});
      tools.push(...r.tools);
      cursor = r.nextCursor;
    } while (cursor);
    return tools;
  }

  callTool(name, args = {}) {
    return this.request("tools/call", { name, arguments: args });
  }
}
