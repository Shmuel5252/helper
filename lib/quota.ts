// Daily-quota handling: parse the provider's 429, compute when it resets, and remember
// exhausted model groups in the browser until then. Pure functions (no DOM), unit-tested.

// ---- Provider error parsing (server) ----

// Gemini names the quota that ran out (…PerDay…) and usually says when to retry,
// e.g. "retryDelay": "19076s" or "Please retry in 5h17m56.3s".
export function parseQuotaError(body: unknown, message = ""): { daily: boolean; retryMs: number | null } {
  const text = JSON.stringify(body ?? "").replace(/\\"/g, '"') + " " + message;
  const daily = /PerDay/i.test(text);
  const delay = text.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  if (delay) return { daily, retryMs: Math.round(Number(delay[1]) * 1000) };
  const human = text.match(/retry in (?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?/i);
  if (human && (human[1] || human[2] || human[3])) {
    const ms = ((+(human[1] ?? 0) * 60 + +(human[2] ?? 0)) * 60 + +(human[3] ?? 0)) * 1000;
    return { daily, retryMs: Math.round(ms) };
  }
  return { daily, retryMs: null };
}

// Minutes Los Angeles is ahead of UTC at `ts` (negative: -480 in winter, -420 in summer).
function pacificOffsetMinutes(ts: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(new Date(ts));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const local = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return Math.round((local - Math.floor(ts / 60000) * 60000) / 60000);
}

// Google resets daily quotas at midnight Pacific time. DST switches happen at 2am,
// so the offset at the coming midnight is unambiguous.
export function nextPacificMidnight(now: number): number {
  const local = new Date(now + pacificOffsetMinutes(now) * 60000); // UTC fields = LA wall clock
  const midnightAsUtc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1);
  const guess = midnightAsUtc - pacificOffsetMinutes(now) * 60000;
  return midnightAsUtc - pacificOffsetMinutes(guess) * 60000;
}

export function quotaResetAt(now: number, retryMs: number | null): number {
  return retryMs && retryMs > 0 ? now + retryMs : nextPacificMidnight(now);
}

// ---- Exhausted groups in localStorage (browser) ----

export const QUOTA_KEY = "ai-chat:quota";
export type Exhausted = Record<string, number>; // model group -> reset timestamp (ms)
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function write(storage: Store | null, map: Exhausted) {
  try {
    if (Object.keys(map).length) storage?.setItem(QUOTA_KEY, JSON.stringify(map));
    else storage?.removeItem(QUOTA_KEY);
  } catch {
    // not persisted; the badge still shows this session
  }
}

// Reads the stored map, dropping (and forgetting) groups whose reset time has passed.
export function loadExhausted(storage: Store | null, now: number): Exhausted {
  let raw: unknown = null;
  try {
    raw = JSON.parse(storage?.getItem(QUOTA_KEY) ?? "null");
  } catch {
    // corrupt: start over
  }
  const map: Exhausted = {};
  if (raw && typeof raw === "object")
    for (const [group, at] of Object.entries(raw)) if (typeof at === "number" && at > now) map[group] = at;
  if (JSON.stringify(map) !== JSON.stringify(raw)) write(storage, map);
  return map;
}

export function markExhausted(storage: Store | null, group: string, resetAt: number, now: number): Exhausted {
  const map = { ...loadExhausted(storage, now), [group]: resetAt };
  write(storage, map);
  return map;
}

export function isExhausted(map: Exhausted, group: string | undefined, now: number): boolean {
  return !!group && (map[group] ?? 0) > now;
}

// "נגמרה המכסה · מתחדש בעוד 3 שעות" (or "מחר" when more than 12 hours away).
export function exhaustedLabel(resetAt: number, now: number): string {
  const hours = Math.max(1, Math.ceil((resetAt - now) / 3_600_000));
  const when = hours > 12 ? "מחר" : hours === 1 ? "בעוד שעה" : hours === 2 ? "בעוד שעתיים" : `בעוד ${hours} שעות`;
  return `נגמרה המכסה · מתחדש ${when}`;
}
