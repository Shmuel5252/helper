import "server-only";
import { findImageError } from "@/lib/images";
import { configured, NotConnected, status as connectionStatus } from "./connection";
import { israelDay } from "./day";
import { callTool, ToolError } from "./mcp";
import {
  DEFAULT_IMAGE_MODELS,
  DEFAULT_VIDEO_MODELS,
  modeFor,
  parseMediaOptions,
  publicMediaOptions,
  type MediaKind,
  type MediaOption,
} from "./media-config";
import { getJson, redis, setJson } from "./redis";
import { adjust, DAILY_CAP, reserve, usage } from "./usage";

export const CDN_URL = (process.env.OPENART_CDN_URL || "https://cdn.openart.ai").replace(/\/$/, "");

const OPTIONS: Record<MediaKind, MediaOption[]> = {
  image: parseMediaOptions(process.env.OPENART_IMAGE_MODELS, DEFAULT_IMAGE_MODELS),
  video: parseMediaOptions(process.env.OPENART_VIDEO_MODELS, DEFAULT_VIDEO_MODELS),
};

export const MSG = {
  unavailable: "יצירת תמונות וסרטונים לא זמינה כרגע.",
  noCredits: "אין מספיק קרדיטים בחשבון ה-OpenArt.",
  cap: (cap: number) => `הגעתם לתקרה היומית של ${cap} קרדיטים. אפשר לנסות שוב מחר.`,
  blocked: "הבקשה נחסמה על ידי מסנן התוכן של OpenArt. נסו לנסח אחרת.",
  timeout: "השירות לא הגיב בזמן. נסו שוב בעוד רגע.",
  failed: "היצירה נכשלה. נסו שוב.",
  cancelled: "היצירה בוטלה.",
  priceChanged: "המחיר השתנה. בדקו את המחיר החדש ואשרו שוב.",
  unknownOption: "האפשרות שנבחרה לא קיימת.",
  promptRequired: "כתבו תיאור קצר של מה ליצור.",
  badImage: "לא הצלחנו להשתמש בתמונה שצירפתם. נסו תמונה אחרת.",
  notFound: "היצירה לא נמצאה.",
};

export class MediaError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

// Maps a provider/connection failure to a Hebrew message.
export function hebrewMediaError(e: unknown): MediaError {
  if (e instanceof MediaError) return e;
  if (e instanceof NotConnected) return new MediaError(MSG.unavailable, 503);
  const text = `${(e as Error)?.message ?? ""} ${JSON.stringify((e as ToolError)?.data ?? "")}`;
  if ((e as Error)?.name === "TimeoutError" || /timed? ?out/i.test(text)) return new MediaError(MSG.timeout, 504);
  if (/insufficient|not enough credit|balance/i.test(text)) return new MediaError(MSG.noCredits, 402);
  if (/moderation|safety|policy|blocked|nsfw|prohibited/i.test(text)) return new MediaError(MSG.blocked, 422);
  console.error("OpenArt request failed:", (e as Error)?.message);
  return new MediaError(MSG.failed, 502);
}

export async function mediaConfig() {
  const available = configured() && (await connectionStatus().catch(() => null))?.connected === true;
  return {
    configured: configured(), // false: the site has no OpenArt setup at all (modes hidden)
    available, // false while disconnected/broken: modes shown with a Hebrew notice
    image: [], // Image generation is exclusively handled by Realistic Vision.
    video: publicMediaOptions(OPTIONS.video),
    usage: available ? await usage().catch(() => null) : null,
  };
}

function option(kind: unknown, key: unknown): { kind: MediaKind; opt: MediaOption } {
  if(kind==='image')throw new MediaError('תמונות נוצרות רק באמצעות Realistic Vision במחשב.',409);
  if (kind !== "image" && kind !== "video") throw new MediaError(MSG.unknownOption);
  const opt = OPTIONS[kind].find((o) => o.key === key); // allowlist: never a client-supplied model id
  if (!opt) throw new MediaError(MSG.unknownOption);
  return { kind, opt };
}

type CostResult = { items?: { totalCredits: number; affordable?: boolean }[]; balance?: number };

async function cost(kind: MediaKind, opt: MediaOption, withImage: boolean) {
  const r = await callTool<CostResult>("openart_model_cost", {
    model: opt.model,
    mode: modeFor(kind, withImage),
    params: { ...opt.settings, prompt: "x" },
  });
  const item = r.items?.[0];
  if (typeof item?.totalCredits !== "number") throw new Error("no price in model_cost result");
  return { credits: item.totalCredits, affordable: item.affordable !== false };
}

export async function quote(body: { kind?: unknown; key?: unknown; withImage?: unknown }) {
  const { kind, opt } = option(body.kind, body.key);
  const [{ credits, affordable }, today] = await Promise.all([cost(kind, opt, !!body.withImage), usage()]);
  return { credits, affordable, cap: today.cap, remaining: today.remaining };
}

// ---- Reference images (image edit / image→video start frame) ----

const MEDIA_PATH = /^\/media\/((?:[A-Za-z0-9._~-]+\/)*[A-Za-z0-9._~-]+)$/;
export const cdnPath = (proxied: string) => proxied.match(MEDIA_PATH)?.[1] ?? null;

// A result URL on the CDN → the same file through our own domain. Anything else is refused,
// so the browser never talks to a third party.
export function toProxied(url: string | undefined): string | null {
  if (!url || !url.startsWith(`${CDN_URL}/`)) return null;
  const path = url.slice(CDN_URL.length + 1).split("?")[0];
  return MEDIA_PATH.test(`/media/${path}`) ? `/media/${path}` : null;
}

type VisualRef = { type: "image"; id: string; url: string; label: string };

async function uploadReference(kind: MediaKind, image: { dataUrl?: unknown; source?: unknown }): Promise<VisualRef> {
  let bytes: Buffer;
  let contentType: string;
  if (typeof image.dataUrl === "string") {
    if (findImageError([{ images: [image.dataUrl] }])) throw new MediaError(MSG.badImage);
    const m = image.dataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/)!;
    contentType = m[1];
    bytes = Buffer.from(m[2], "base64");
  } else if (typeof image.source === "string" && cdnPath(image.source)) {
    // A previous result: fetch it from the CDN server-side and re-upload it.
    const res = await fetch(`${CDN_URL}/${cdnPath(image.source)}`, { signal: AbortSignal.timeout(20_000) });
    contentType = res.headers.get("content-type") ?? "";
    if (!res.ok || !contentType.startsWith("image/")) throw new MediaError(MSG.badImage);
    bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > 10_000_000) throw new MediaError(MSG.badImage);
  } else throw new MediaError(MSG.badImage);

  const ext = contentType.split("/")[1].replace("jpeg", "jpg");
  const signed = await callTool<{ uploadId: string; signURL: string; accessURL: string }>("openart_upload_sign", {
    mediaType: "image",
    size: bytes.length,
    contentType,
    filename: `reference.${ext}`,
    purpose: kind === "video" ? "create-video" : "create-image",
  });
  const put = await fetch(signed.signURL, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: new Uint8Array(bytes),
    signal: AbortSignal.timeout(30_000),
  });
  if (!put.ok) throw new Error(`upload PUT ${put.status}`);
  // The upload is accepted asynchronously: give it a few seconds.
  for (let i = 0; ; i++) {
    try {
      const meta = await callTool<{ visualReference: VisualRef }>("openart_upload_metadata_get", {
        mediaUrl: signed.accessURL,
        mediaType: "image",
        uploadId: signed.uploadId,
        label: "reference",
      });
      const { type, id, url, label } = meta.visualReference; // the forms accept exactly these fields
      return { type, id, url, label };
    } catch (e) {
      if (i >= 4) throw e;
      await new Promise((r) => setTimeout(r, 1200));
    }
  }
}

// ---- Generate / status ----

type Job = { kind: MediaKind; key: string; credits: number; day: string; prompt: string };
const jobKey = (id: string) => `openart:job:${id}`;

export async function generate(body: {
  kind?: unknown;
  key?: unknown;
  prompt?: unknown;
  credits?: unknown;
  image?: { dataUrl?: unknown; source?: unknown } | null;
}) {
  const { kind, opt } = option(body.kind, body.key);
  const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 2000) : "";
  if (!prompt) throw new MediaError(MSG.promptRequired);
  const withImage = !!body.image;

  // The client confirmed a specific price; refuse if it changed since.
  const fresh = await cost(kind, opt, withImage);
  if (body.credits !== fresh.credits) throw new MediaError(MSG.priceChanged, 409, { credits: fresh.credits });
  if (!fresh.affordable) throw new MediaError(MSG.noCredits, 402);
  if (!(await reserve(fresh.credits))) throw new MediaError(MSG.cap(DAILY_CAP!), 429, { cap: DAILY_CAP });

  const day = israelDay();
  try {
    const params: Record<string, unknown> = { ...opt.settings, prompt };
    if (body.image) {
      const ref = await uploadReference(kind, body.image);
      if (kind === "video") params.startFrame = ref;
      else params.visualReferences = [ref];
    }
    const r = await callTool<{ historyId?: string }>(kind === "video" ? "openart_generate_video" : "openart_generate_image", {
      model: opt.model,
      mode: modeFor(kind, withImage),
      params,
    });
    if (!r.historyId) throw new Error("no historyId");
    await setJson(jobKey(r.historyId), { kind, key: opt.key, credits: fresh.credits, day, prompt } satisfies Job, 7 * 86_400);
    return { id: r.historyId, credits: fresh.credits };
  } catch (e) {
    await adjust(-fresh.credits, day); // nothing was started: give the booking back
    throw e;
  }
}

type Resource = { url?: string; thumbnailUrl?: string; mediaType?: string; metadata?: { width?: number; height?: number } };
type Creation = {
  status: string;
  pollAfterSeconds?: number;
  creditsCharged?: number;
  resources?: Resource[];
  error?: string;
  failedCode?: string;
};

export async function jobStatus(id: unknown) {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new MediaError(MSG.notFound, 404);
  const job = await getJson<Job>(jobKey(id)); // only jobs this site started
  if (!job) throw new MediaError(MSG.notFound, 404);
  const c = await callTool<Creation>("openart_creation_get", { historyId: id });

  if (c.status === "PENDING" || c.status === "RUNNING") return { status: "running" as const, pollAfter: Math.max(4, c.pollAfterSeconds ?? 4) };

  // Terminal: settle the booked credits with what OpenArt really charged, exactly once.
  const charged = c.status === "COMPLETED" ? (c.creditsCharged ?? job.credits) : (c.creditsCharged ?? 0);
  if ((await redis("SET", `${jobKey(id)}:settled`, "1", "NX", "EX", 7 * 86_400)) === "OK") await adjust(charged - job.credits, job.day);

  if (c.status === "COMPLETED") {
    const res = c.resources?.find((r) => r.url) ?? {};
    const url = toProxied(res.url);
    if (!url) return { status: "failed" as const, error: MSG.failed };
    return {
      status: "done" as const,
      url,
      poster: toProxied(res.thumbnailUrl) ?? undefined,
      mediaType: res.mediaType === "video" ? "video" : "image",
      width: res.metadata?.width,
      height: res.metadata?.height,
      credits: charged,
    };
  }
  const blocked = /moderation|safety|policy|blocked|nsfw|prohibited/i.test(`${c.failedCode ?? ""} ${c.error ?? ""}`);
  return { status: "failed" as const, error: c.status === "CANCELLED" ? MSG.cancelled : blocked ? MSG.blocked : MSG.failed };
}
