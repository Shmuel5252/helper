import "server-only";

// Upstash Redis over its REST API: one fetch per command, no client library needed.
// Vercel's Marketplace integration sets KV_REST_API_* (older) or UPSTASH_REDIS_REST_* names.
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export const redisConfigured = () => !!(URL_ && TOKEN);

export async function redis<T = unknown>(...command: (string | number)[]): Promise<T> {
  if (!URL_ || !TOKEN) throw new Error("Redis is not configured");
  const res = await fetch(URL_, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(command.map(String)),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => null)) as { result?: T; error?: string } | null;
  if (!res.ok || !body || body.error) throw new Error(`Redis ${command[0]} failed: ${res.status} ${body?.error ?? ""}`);
  return body.result as T;
}

export async function getJson<T>(key: string): Promise<T | null> {
  const raw = await redis<string | null>("GET", key);
  return raw ? (JSON.parse(raw) as T) : null;
}

export const setJson = (key: string, value: unknown, ttlSeconds?: number) =>
  ttlSeconds ? redis("SET", key, JSON.stringify(value), "EX", ttlSeconds) : redis("SET", key, JSON.stringify(value));
