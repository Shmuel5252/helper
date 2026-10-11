import { APIConnectionTimeoutError, APIError } from "openai";
import { MSG_GENERIC } from "@/lib/chat";

// Maps an upstream (NVIDIA) failure to a Hebrew message the user can act on.
export function hebrewError(e: unknown): string {
  if (e instanceof APIConnectionTimeoutError) return "השרת לא הגיב בזמן. נסו שוב.";
  if (e instanceof APIError) {
    if (e.status === 429) return "הגעתם למגבלת השימוש. נסו שוב בעוד כמה דקות.";
    if (e.status === 401 || e.status === 403) return "שירות ה-AI דחה את הבקשה (בעיית הרשאה). פנו למנהל האתר.";
    if (e.status === 404) return "המודל שהוגדר לא נמצא. פנו למנהל האתר.";
    if (e.status === 400) return "הבקשה לא התקבלה. נסו לקצר את ההודעה או לפתוח שיחה חדשה.";
    if (!e.status) return "אין תקשורת עם שירות ה-AI. נסו שוב.";
    if (e.status >= 500) return "שירות ה-AI לא זמין כרגע. נסו שוב בעוד רגע.";
  }
  return MSG_GENERIC;
}
