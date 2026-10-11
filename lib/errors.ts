import { APIConnectionTimeoutError, APIError } from "openai";
import { MSG_GENERIC } from "@/lib/chat";
import { parseQuotaError } from "@/lib/quota";

// Gemini reports which quota ran out; a per-day one won't recover in a minute.
export const isDailyQuota = (e: unknown): e is APIError =>
  e instanceof APIError && e.status === 429 && parseQuotaError(e.error, e.message).daily;

// Maps an upstream AI-provider failure to a Hebrew message the user can act on.
// `alternatives`: the picker has an option on a *different* model (quotas are per model),
// so switching is worth suggesting.
export function hebrewError(e: unknown, { alternatives = false } = {}): string {
  if (e instanceof APIConnectionTimeoutError) return "השרת לא הגיב בזמן. נסו שוב.";
  if (e instanceof APIError) {
    if (isDailyQuota(e))
      return alternatives
        ? "נגמרה המכסה היומית של האפשרות הזו. בחרו אפשרות אחרת מהרשימה למעלה, או נסו שוב מחר."
        : "נגמרה המכסה היומית של שירות ה-AI. נסו שוב מחר.";
    if (e.status === 429)
      return alternatives
        ? "הגעתם למגבלת השימוש. חכו דקה ונסו שוב, או בחרו אפשרות אחרת בתפריט שלמעלה."
        : "הגעתם למגבלת השימוש. חכו דקה ונסו שוב.";
    if (e.status === 401 || e.status === 403) return "שירות ה-AI דחה את הבקשה (בעיית הרשאה). פנו למנהל האתר.";
    if (e.status === 404) return "המודל שהוגדר לא נמצא. פנו למנהל האתר.";
    if (e.status === 400) return "הבקשה לא התקבלה. נסו לקצר את ההודעה או לפתוח שיחה חדשה.";
    if (!e.status) return "אין תקשורת עם שירות ה-AI. נסו שוב.";
    if (e.status >= 500) return "שירות ה-AI לא זמין כרגע. נסו שוב בעוד רגע.";
  }
  return MSG_GENERIC;
}
