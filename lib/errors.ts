import { APIConnectionTimeoutError, APIError } from "openai";
import { MSG_GENERIC } from "@/lib/chat";

// Maps an upstream AI-provider failure to a Hebrew message the user can act on.
// `alternatives`: other model options exist in the picker, so suggest them on rate limits.
export function hebrewError(e: unknown, { alternatives = false } = {}): string {
  if (e instanceof APIConnectionTimeoutError) return "השרת לא הגיב בזמן. נסו שוב.";
  if (e instanceof APIError) {
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
