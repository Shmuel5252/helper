// Calendar day in Israel (YYYY-MM-DD), the unit of the daily credit cap. Pure, unit-tested.
export function israelDay(now: number = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(now);
}
