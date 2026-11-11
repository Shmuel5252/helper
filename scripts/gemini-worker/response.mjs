// Classify provider response text only; never execute or resend its contents.
export function generationUnavailable(text){
  // A rejected request is terminal even when the reason is temporary overload.
  // Do not match a generic high-demand notice while generation is still running.
  if(/לא יכול(?:ה|\/ה)? לקבל[^.\n]{0,80}בקשות[^.\n]{0,40}סרטונ/u.test(text)
    || /(?:can['’]t|cannot|unable to) (?:take|accept)[^.\n]{0,60}video requests/i.test(text))return true;
  if(/אני לא יכול(?:ה|\/ה)?\s+(?:ליצור|לייצר|להפיק|לעזור)|I (?:can['’]t|cannot|am unable to)\s+(?:generate|create|help)/iu.test(text))return true;
  return /reached.*limit|try again tomorrow|verify.*human|captcha|הגעת.*מכסה|מכסת.*נגמרה|נסו שוב מחר|לא ניתן ליצור|אין לי יכולת|אני רק מודל שפה|I(?:'m| am) (?:only |just )?a language model/i.test(text)
    || /אין לי אפשרות(?: טכנית)?\s+(?:ליצור|לייצר|להנפיש|להפיק|לערוך)[^.\n]{0,100}(?:וידאו|סרטו|תמונ)/u.test(text)
    || /אין לי אפשרות לעזור[^.\n]{0,160}מודל שפה/u.test(text)
    || /מבוסס טקסט[^.\n]{0,80}אין לי אפשרות לעזור לך במקרה הזה/u.test(text);
}
