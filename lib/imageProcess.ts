// Browser-only: turns a picked file into a resized JPEG (to send) and a small thumbnail (to keep).
// Loaded lazily the first time the attach button is used, so it never weighs on the first load.
import { dataUrlBytes, IMAGE_MAX_BYTES, IMAGE_TARGET_BYTES } from "@/lib/images";

export class ImageError extends Error {}

const ACCEPTED = /^image\/(jpeg|png|webp|heic|heif)$/;
const HEIC_NAME = /\.(heic|heif)$/i;
const MAX_INPUT_BYTES = 30 * 1024 * 1024;

// <img> decoding applies EXIF orientation (image-orientation: from-image is the default),
// and drawImage keeps it, so rotated phone photos come out upright.
async function decode(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toJpeg(img: HTMLImageElement, maxSide: number, quality: number): string {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.fillStyle = "#fff"; // transparent PNGs would turn black as JPEG
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", quality);
}

export async function prepareImage(file: File): Promise<{ full: string; thumb: string }> {
  const heic = HEIC_NAME.test(file.name) || /hei[cf]/.test(file.type);
  if (!ACCEPTED.test(file.type) && !heic) throw new ImageError("אפשר לצרף רק תמונות (JPEG, PNG, WebP או HEIC).");
  if (file.size > MAX_INPUT_BYTES) throw new ImageError("הקובץ גדול מדי (עד 30MB).");

  let img: HTMLImageElement;
  try {
    img = await decode(file);
  } catch {
    throw new ImageError(
      heic
        ? "הדפדפן הזה לא מצליח לפתוח תמונות HEIC. שמרו את התמונה כ-JPEG (או צלמו מסך שלה) ונסו שוב."
        : "לא הצלחנו לפתוח את התמונה. נסו תמונה אחרת.",
    );
  }

  try {
    // Up to 1600px on the long side; step quality/size down until it's comfortably small.
    let full = toJpeg(img, 1600, 0.85);
    for (const [side, q] of [[1600, 0.72], [1280, 0.7], [1024, 0.65]] as const) {
      if (dataUrlBytes(full) <= IMAGE_TARGET_BYTES) break;
      full = toJpeg(img, side, q);
    }
    if (dataUrlBytes(full) > IMAGE_MAX_BYTES) throw new ImageError("התמונה מפורטת מדי ולא הצלחנו להקטין אותה. נסו תמונה אחרת.");
    return { full, thumb: toJpeg(img, 200, 0.7) };
  } catch (e) {
    if (e instanceof ImageError) throw e;
    throw new ImageError("לא הצלחנו לעבד את התמונה. נסו שוב או בחרו תמונה אחרת.");
  }
}
