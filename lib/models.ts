// Server-side model allowlist, configured by AI_MODELS. Pure functions, unit-tested.
//
// AI_MODELS = entries separated by commas, each `key|model id|label|description|effort|vision`
// (effort: none/low/medium/high, off = don't send it, empty = AI_REASONING_EFFORT):
//   fast|gemini-3.6-flash|מהיר|לרוב השאלות|none|1,deep|gemini-3.6-flash|מעמיק|לשאלות מורכבות, איטי יותר|medium|1
// An entry boundary is a comma right after the vision field and before the next `key|`,
// so descriptions may contain commas. Malformed entries are skipped (with a warning).

// "off" = don't send reasoning_effort at all (some models, e.g. Gemini Flash-Lite, reject it).
export const EFFORTS = ["none", "low", "medium", "high", "off"] as const;
export type Effort = Exclude<(typeof EFFORTS)[number], "off"> | "";

export type ModelEntry = {
  key: string;
  model: string;
  label: string;
  description: string;
  effort: Effort; // "" = don't send reasoning_effort
  vision: boolean;
};

// What the browser may see: never the model id, key or base URL.
export type PublicModel = Pick<ModelEntry, "key" | "label" | "description" | "vision">;

const KEY_RE = /^[a-z0-9_-]{1,32}$/i;

// Valid field → effort to send ("" = don't send); "default" = use AI_REASONING_EFFORT; null = invalid.
function toEffort(v: string): Effort | "default" | null {
  if (v === "") return "default";
  if (v === "off") return "";
  return (EFFORTS as readonly string[]).includes(v) ? (v as Effort) : null;
}

export function parseModels(
  raw: string | undefined,
  fallback: { model?: string; effort: string },
  warn: (msg: string) => void = console.warn,
): ModelEntry[] {
  // AI_REASONING_EFFORT: empty or "off" = don't send; unknown values fall back to "none".
  const g = toEffort(fallback.effort);
  const defaultEffort: Effort = g === "default" ? "" : (g ?? "none");
  const entries: ModelEntry[] = [];

  for (const chunk of (raw ?? "").split(/(?<=\|\s*[01]?\s*)[,\n]\s*(?=[^|,\n]+\|)/)) {
    if (!chunk.trim()) continue;
    const f = chunk.split("|").map((s) => s.trim());
    const [key, model, label, description, effort, vision] = f;
    const e = toEffort(effort ?? "");
    if (f.length !== 6 || !KEY_RE.test(key) || !model || !label || e === null || !/^[01]?$/.test(vision)) {
      warn(`AI_MODELS: skipping malformed entry "${chunk}"`);
      continue;
    }
    if (entries.some((x) => x.key === key)) {
      warn(`AI_MODELS: skipping duplicate key "${key}"`);
      continue;
    }
    entries.push({ key, model, label, description, effort: e === "default" ? defaultEffort : e, vision: vision === "1" });
  }

  if (entries.length) return entries;
  if (!fallback.model) return [];
  // No (valid) AI_MODELS: a single entry from AI_MODEL; the picker stays hidden.
  // Vision is off here because a plain AI_MODEL may be text-only; use AI_MODELS to enable images.
  return [{ key: "default", model: fallback.model, label: "ברירת מחדל", description: "", effort: defaultEffort, vision: false }];
}

// The requested entry if it is on the allowlist, otherwise the default (first) one.
// A client-supplied model id is never used.
export function resolveModel(entries: ModelEntry[], key: unknown): ModelEntry | undefined {
  return entries.find((e) => e.key === key) ?? entries[0];
}

export function publicModels(entries: ModelEntry[]): PublicModel[] {
  return entries.map(({ key, label, description, vision }) => ({ key, label, description, vision }));
}
