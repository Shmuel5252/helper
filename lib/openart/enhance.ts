import type { MediaKind } from "./media-config";

// Turns the user's (usually Hebrew) request into a clear English prompt for the image/video
// models, which misread Hebrew (e.g. "מטוס על" became an El Al plane). Pure: unit-tested.

const TASK = {
  image: "an AI image generator",
  edit: "an AI image editor that changes the attached image",
  video: "an AI video generator",
  animate: "an AI model that animates the attached image into a short video",
} as const;

export function enhanceSystemPrompt(kind: MediaKind, withImage: boolean): string {
  const task = kind === "video" ? (withImage ? "animate" : "video") : withImage ? "edit" : "image";
  return [
    `You write prompts for ${TASK[task]}. The user's request is usually in Hebrew.`,
    "Reply with the prompt only: English, one paragraph, no quotes, no preamble, under 80 words.",
    "Keep exactly what the user asked for. Read ambiguous words literally, in their plain everyday meaning.",
    "Never add brand names, companies, airlines, logos, real people or trademarks unless the user explicitly names them " +
      '(for example, the Hebrew word "על" means "on/above", not the airline El Al).',
    "Do not add text, letters or captions to the picture unless the user asks for them.",
    task === "edit"
      ? "Describe only the change to make to the attached image, briefly."
      : task === "animate"
        ? "Describe the motion and the camera movement; the attached image is the first frame."
        : task === "video"
          ? "Describe the subject, the setting, the motion and the camera movement."
          : "Add helpful visual detail (subject, setting, lighting, composition, style) without changing the request.",
  ].join("\n");
}

const MAX_CHARS = 1000;

// The model's answer → a usable prompt, or "" (caller falls back to the original).
export function cleanEnhanced(text: string): string {
  let s = text
    .replace(/<think>[\s\S]*?(<\/think>|$)/g, "")
    .trim()
    .replace(/^(english\s+)?prompt\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const quoted = s.match(/^["'“”‘’`]+([\s\S]*?)["'“”‘’`]+$/);
  if (quoted) s = quoted[1].trim();
  return s.slice(0, MAX_CHARS);
}

export const ENHANCE_FALLBACK_NOTE = "לא הצלחנו לנסח את הבקשה באנגלית, אז נשלח את התיאור כפי שכתבתם.";

// Which chat models translate, in order (AI_PROMPT_MODELS: AI_MODELS keys). The default tries the
// options that don't share the main chat model's quota first. Unknown keys are skipped, and a
// second key on an already-listed model id is skipped too (quotas and outages are per model).
export const DEFAULT_PROMPT_MODELS = "alt,lite,fast";

export function promptModels<T extends { key: string; model: string }>(entries: T[], raw: string | undefined): T[] {
  const keys = (raw?.trim() ? raw : DEFAULT_PROMPT_MODELS).split(",").map((k) => k.trim());
  const out: T[] = [];
  for (const k of keys) {
    const e = entries.find((x) => x.key === k);
    if (e && !out.some((x) => x.model === e.model)) out.push(e);
  }
  return out.length ? out : entries.slice(0, 1); // none of them configured: the default option
}

// Why a translation attempt failed: "quota" = a per-day limit ran out; "temporary" = rate limit,
// overload (5xx), timeout or network; "other" = anything else (bad key, unknown model...).
export type FailureKind = "quota" | "temporary" | "other";

const NOTES: Record<FailureKind, string> = {
  quota: "המכסה היומית לניסוח נגמרה, אז נשלח את התיאור כפי שכתבתם.",
  temporary: "שגיאה זמנית בניסוח, אז נשלח את התיאור כפי שכתבתם.",
  other: ENHANCE_FALLBACK_NOTE,
};

// The note after every model failed: quota only when all of them ran out for the day.
export function fallbackReason(kinds: FailureKind[]): FailureKind {
  if (kinds.length && kinds.every((k) => k === "quota")) return "quota";
  return kinds.includes("temporary") ? "temporary" : "other";
}

export const fallbackNote = (reason: FailureKind) => NOTES[reason];
