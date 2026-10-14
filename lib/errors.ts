import { APIConnectionError, APIConnectionTimeoutError, APIError } from "openai";
import { MSG_GENERIC } from "./chat.ts";
import { parseQuotaError } from "./quota.ts";

// What went wrong with an AI-provider call:
// "quota"     a per-day limit ran out (won't recover until tomorrow)
// "rate"      a short limit (per minute): wait a minute
// "temporary" overloaded / unavailable (5xx)
// "timeout"   no answer in time
// "network"   no connection to the provider
// "auth" | "notFound" | "badRequest" | "other"
export type AiFailure = "quota" | "rate" | "temporary" | "timeout" | "network" | "auth" | "notFound" | "badRequest" | "other";

// A retry this far away means a daily limit, even when the quota's name doesn't say "PerDay".
const DAILY_RETRY_MS = 30 * 60_000;

// Works for request errors (HTTP status) and for errors that arrive inside a stream, which have
// no status, only the provider's error body/message (Gemini: RESOURCE_EXHAUSTED, UNAVAILABLE).
export function classifyAiError(e: unknown): AiFailure {
  const status = e instanceof APIError ? e.status : undefined;
  const body = e instanceof APIError ? e.error : undefined;
  const message = e instanceof Error ? e.message : "";
  const text = `${JSON.stringify(body ?? "")} ${message}`;

  if (status === 429 || /RESOURCE_EXHAUSTED|exceeded your current quota|quota exceeded/i.test(text)) {
    const { daily, retryMs } = parseQuotaError(body, message);
    return daily || (retryMs ?? 0) >= DAILY_RETRY_MS ? "quota" : "rate";
  }
  if (e instanceof APIConnectionTimeoutError || (e as Error)?.name === "TimeoutError") return "timeout";
  if (e instanceof APIConnectionError) return "network";
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "notFound";
  if (status === 400) return "badRequest";
  if ((status ?? 0) >= 500 || /UNAVAILABLE|overloaded|high demand|INTERNAL/.test(text)) return "temporary";
  if (e instanceof APIError) return "network"; // no status and nothing recognizable: the connection dropped
  return "other";
}

export const isDailyQuota = (e: unknown): e is APIError => e instanceof APIError && classifyAiError(e) === "quota";

// Maps an upstream AI-provider failure to a Hebrew message the user can act on.
// `alternatives`: the picker has an option on a *different* model (quotas are per model),
// so switching is worth suggesting.
export function hebrewError(e: unknown, { alternatives = false } = {}): string {
  switch (classifyAiError(e)) {
    case "quota":
      return alternatives
        ? "המכסה היומית של המודל הזה נגמרה. החליפו מודל בכפתור ליד השליחה, או נסו שוב מחר."
        : "המכסה היומית של שירות ה-AI נגמרה. נסו שוב מחר.";
    case "rate":
      return alternatives
        ? "הגעתם למגבלת השימוש. חכו דקה ונסו שוב, או החליפו מודל בכפתור ליד השליחה."
        : "הגעתם למגבלת השימוש. חכו דקה ונסו שוב.";
    case "temporary":
      return "שירות ה-AI לא זמין כרגע. נסו שוב בעוד רגע.";
    case "timeout":
      return "שירות ה-AI לא הגיב בזמן. נסו שוב בעוד רגע.";
    case "network":
      return "אין תקשורת עם שירות ה-AI. נסו שוב בעוד רגע.";
    case "auth":
      return "שירות ה-AI דחה את הבקשה (בעיית הרשאה). פנו למנהל האתר.";
    case "notFound":
      return "המודל שהוגדר לא נמצא. פנו למנהל האתר.";
    case "badRequest":
      return "הבקשה לא התקבלה. נסו לקצר את ההודעה או לפתוח שיחה חדשה.";
    default:
      return MSG_GENERIC;
  }
}
