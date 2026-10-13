import "server-only";
import { accessToken, MCP_URL } from "./connection";

// Minimal MCP client over Streamable HTTP for one tool call per server request:
// initialize → notifications/initialized → tools/call. On 401 it refreshes (through the
// shared lock) and retries once. Ported from spikes/openart/mcp.mjs.

const PROTOCOL = "2025-06-18";

export class ToolError extends Error {
  constructor(
    message: string,
    readonly data: unknown,
  ) {
    super(message);
  }
}

type Rpc = { jsonrpc: "2.0"; id?: number; method: string; params?: unknown };

async function post(payload: Rpc, token: string, sessionId: string | null) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${token}`,
    "MCP-Protocol-Version": PROTOCOL,
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  // Short calls only (status polls, quotes, submits): keeps every request well inside Vercel limits.
  return fetch(MCP_URL, { method: "POST", headers, body: JSON.stringify(payload), cache: "no-store", signal: AbortSignal.timeout(25_000) });
}

async function readReply(res: Response, id: number) {
  const text = await res.text();
  const messages = (res.headers.get("content-type") ?? "").includes("text/event-stream")
    ? text
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => JSON.parse(l.slice(5)))
    : [JSON.parse(text)];
  const reply = messages.find((m) => m.id === id);
  if (!reply) throw new Error(`MCP: no reply for request ${id}`);
  if (reply.error) throw new Error(`MCP error ${reply.error.code}: ${reply.error.message}`);
  return reply.result;
}

async function session(token: string) {
  const res = await post(
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "ai-chat", version: "1" } } },
    token,
    null,
  );
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`MCP initialize HTTP ${res.status}`);
  const sessionId = res.headers.get("mcp-session-id");
  await readReply(res, 1);
  await post({ jsonrpc: "2.0", method: "notifications/initialized" }, token, sessionId);
  return sessionId;
}

// Calls an OpenArt tool and returns its structured result (or the JSON in its text content).
export async function callTool<T = Record<string, unknown>>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  let token = await accessToken();
  for (let attempt = 0; attempt < 2; attempt++) {
    const sid = await session(token);
    if (sid === null) {
      token = await accessToken({ failed: token });
      continue;
    }
    const res = await post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } }, token, sid);
    if (res.status === 401) {
      token = await accessToken({ failed: token });
      continue;
    }
    if (!res.ok) throw new Error(`MCP tools/call HTTP ${res.status}`);
    const result = await readReply(res, 2);
    const text = (result.content ?? []).find((c: { type: string }) => c.type === "text")?.text as string | undefined;
    const data = result.structuredContent ?? (text ? safeJson(text) : null);
    if (result.isError) throw new ToolError(text ?? "tool error", data);
    return (data ?? {}) as T;
  }
  throw new Error("MCP: unauthorized after refresh");
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}
