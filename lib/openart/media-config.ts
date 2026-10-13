// Allowlisted OpenArt generation options, from OPENART_IMAGE_MODELS / OPENART_VIDEO_MODELS.
// Entry: `key|model id|Hebrew label|short Hebrew description|settings`, settings as `a=b;c=d`
// (numbers and true/false are converted). Entries are comma-separated; a description may contain
// commas because an entry is complete once it has its 5 fields. Pure, unit-tested.

export type MediaKind = "image" | "video";
export type MediaOption = {
  key: string;
  model: string;
  label: string;
  description: string;
  settings: Record<string, string | number | boolean>;
};
export type PublicMediaOption = Pick<MediaOption, "key" | "label" | "description"> & { modelName: string };

export const DEFAULT_IMAGE_MODELS =
  "lite|nano-banana-2-lite|חסכוני|תמונה מהירה וזולה|,nb2|nano-banana-2|איכותי|פרטים עשירים יותר|resolution=1K";
export const DEFAULT_VIDEO_MODELS =
  "pixverse|pixverseV6|סרטון קצר|5 שניות, 540p|duration=5;resolution=540p;generateAudio=false,veo|veo3-1|סרטון איכותי|4 שניות, 720p, עם שמע|duration=4;resolution=720p;mode=lite";

const KEY_RE = /^[a-z0-9_-]{1,32}$/i;

function parseSettings(raw: string): Record<string, string | number | boolean> | null {
  const out: Record<string, string | number | boolean> = {};
  for (const pair of raw.split(";").map((s) => s.trim()).filter(Boolean)) {
    const [k, v, ...extra] = pair.split("=").map((s) => s.trim());
    if (!k || v === undefined || extra.length) return null;
    out[k] = v === "true" ? true : v === "false" ? false : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
  }
  return out;
}

export function parseMediaOptions(raw: string | undefined, fallback: string, warn: (m: string) => void = console.warn): MediaOption[] {
  const options: MediaOption[] = [];
  let buf = "";
  const flush = () => {
    const [key, model, label, description, settings] = buf.split("|").map((s) => s.trim());
    const parsed = parseSettings(settings ?? "");
    if (!KEY_RE.test(key ?? "") || !model || !label || !parsed) warn(`OpenArt models: skipping malformed entry "${buf}"`);
    else if (options.some((o) => o.key === key)) warn(`OpenArt models: skipping duplicate key "${key}"`);
    else options.push({ key, model, label, description: description ?? "", settings: parsed });
    buf = "";
  };
  for (const part of (raw?.trim() ? raw : fallback).split(",")) {
    buf = buf ? `${buf},${part}` : part;
    const pipes = buf.split("|").length - 1;
    if (pipes === 4) flush();
    else if (pipes > 4) {
      warn(`OpenArt models: skipping malformed entry "${buf}"`);
      buf = "";
    }
  }
  if (buf.trim()) warn(`OpenArt models: skipping incomplete entry "${buf}"`);
  return options.length || !raw?.trim() ? options : parseMediaOptions(undefined, fallback, warn);
}

// Display names from OpenArt's catalog for the defaults; others fall back to the raw id.
const NAMES: Record<string, string> = {
  "nano-banana-2-lite": "Nano Banana 2 Lite",
  "nano-banana-2": "Nano Banana 2",
  "nano-banana-pro": "Nano Banana Pro",
  pixverseV6: "PixVerse V6",
  "veo3-1": "Veo 3.1",
};

export const publicMediaOptions = (opts: MediaOption[]): PublicMediaOption[] =>
  opts.map(({ key, label, description, model }) => ({ key, label, description, modelName: NAMES[model] ?? model }));

// OpenArt mode for a request: a reference image turns text→image into an edit and
// text→video into image→video.
export const modeFor = (kind: MediaKind, withImage: boolean) =>
  kind === "image" ? (withImage ? "image2image" : "text2image") : withImage ? "image2video" : "text2video";

// OPENART_DAILY_CREDIT_CAP: a positive number caps the credits spent per Israel day.
// Unset, empty, 0 or anything else → null (no daily limit).
export function parseCap(raw: string | undefined): number | null {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}
