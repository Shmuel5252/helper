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
