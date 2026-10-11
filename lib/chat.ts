import { DEFAULT_IMAGE_PROMPT, IMAGE_PLACEHOLDER, MAX_IMAGES } from "./images.ts";

export const MAX_MESSAGES = 20;
export const MAX_CHARS = 4000;

// Separates streamed answer text from a trailing error message.
export const ERROR_MARK = "\u0000";

// images: data URLs, user messages only.
export type ChatMessage = { role: "user" | "assistant"; content: string; images?: string[] };

// Validates client-sent history and shapes it for the model:
// keeps the last MAX_MESSAGES, caps each message at MAX_CHARS,
// drops leading assistant turns and merges consecutive same-role turns
// (some NVIDIA-hosted models reject non-alternating roles).
// Images: only the latest user message with images keeps them (if the model has vision);
// older ones become a text placeholder, which keeps tokens and request size down.
// Idempotent, so the browser and the server can both run it.
// Returns null when there is nothing valid to answer.
// Image *contents* are validated separately by findImageError().
export function prepareHistory(input: unknown, { vision = false } = {}): ChatMessage[] | null {
  if (!Array.isArray(input)) return null;

  const valid = input
    .filter((m): m is ChatMessage => {
      if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") return false;
      const hasImages = m.role === "user" && Array.isArray(m.images) && m.images.length > 0;
      return m.content.trim() !== "" || hasImages;
    })
    .slice(-MAX_MESSAGES)
    .map((m): ChatMessage => {
      const out: ChatMessage = { role: m.role, content: m.content.slice(0, MAX_CHARS) };
      if (m.role === "user" && Array.isArray(m.images) && m.images.length) out.images = [...m.images];
      return out;
    });

  while (valid[0]?.role === "assistant") valid.shift();

  const out: ChatMessage[] = [];
  for (const m of valid) {
    const prev = out[out.length - 1];
    if (prev?.role === m.role) {
      prev.content = [prev.content, m.content].filter((s) => s.trim()).join("\n\n");
      if (m.images) prev.images = [...(prev.images ?? []), ...m.images];
    } else out.push(m);
  }

  let latest = -1;
  if (vision) for (let i = out.length - 1; i >= 0 && latest < 0; i--) if (out[i].images) latest = i;
  out.forEach((m, i) => {
    if (!m.images) return;
    if (i === latest) {
      m.images = m.images.slice(-MAX_IMAGES);
      if (!m.content.trim()) m.content = DEFAULT_IMAGE_PROMPT;
    } else {
      m.content = [m.content, IMAGE_PLACEHOLDER].filter((s) => s.trim()).join("\n");
      delete m.images;
    }
  });

  return out.length && out[out.length - 1].role === "user" ? out : null;
}

export const MSG_GENERIC = "משהו השתבש. נסו שוב בעוד רגע.";
