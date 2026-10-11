// Image limits and validation shared by the browser, the API route and the tests (pure, no DOM).

export const MAX_IMAGES = 3; // per message
export const IMAGE_TARGET_BYTES = 900_000; // the browser re-encodes until each image is under this
export const IMAGE_MAX_BYTES = 1_000_000; // server limit per image (decoded)
// Whole /api/chat request. Vercel functions accept ~4.5 MB; keep a margin.
export const MAX_BODY_BYTES = 4_000_000;

export const IMAGE_PLACEHOLDER = "[תמונה שנשלחה קודם]";
export const DEFAULT_IMAGE_PROMPT = "תאר את התמונה";

export const IMAGE_ERRORS = {
  type: "אפשר לצרף רק תמונות מסוג JPEG, PNG או WebP.",
  count: `אפשר לצרף עד ${MAX_IMAGES} תמונות להודעה.`,
  size: "אחת התמונות גדולה מדי. נסו תמונה אחרת.",
  body: "התמונות גדולות מדי לשליחה יחד. נסו לשלוח פחות תמונות.",
};

const DATA_URL = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

// Decoded size of a base64 data URL.
export function dataUrlBytes(url: string): number {
  const b64 = url.slice(url.indexOf(",") + 1);
  return Math.floor((b64.length * 3) / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);
}

// Returns a Hebrew error for the first invalid image in any message, or null if all are fine.
export function findImageError(messages: unknown): string | null {
  if (!Array.isArray(messages)) return null;
  for (const m of messages) {
    const images = (m as { images?: unknown })?.images;
    if (images === undefined) continue;
    if (!Array.isArray(images)) return IMAGE_ERRORS.type;
    if (images.length > MAX_IMAGES) return IMAGE_ERRORS.count;
    for (const img of images) {
      if (typeof img !== "string" || !DATA_URL.test(img)) return IMAGE_ERRORS.type;
      if (dataUrlBytes(img) > IMAGE_MAX_BYTES) return IMAGE_ERRORS.size;
    }
  }
  return null;
}
