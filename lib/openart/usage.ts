import "server-only";
import { israelDay } from "./day";
import { parseCap } from "./media-config";
import { redis } from "./redis";

// Credits spent per Israel calendar day, tracked in Redis. The cap is optional (null = no limit);
// usage is tracked either way so the sidebar can show it.
export const DAILY_CAP = parseCap(process.env.OPENART_DAILY_CREDIT_CAP);
const key = (day = israelDay()) => `openart:spent:${day}`;

export async function usage() {
  const spent = Number((await redis<string | null>("GET", key())) ?? 0);
  return { spent, cap: DAILY_CAP, remaining: DAILY_CAP === null ? null : Math.max(0, DAILY_CAP - spent) };
}

// Atomically books `credits` for today; refuses (and undoes) if that would pass the cap.
export async function reserve(credits: number): Promise<boolean> {
  const k = key();
  const total = Number(await redis("INCRBY", k, credits));
  await redis("EXPIRE", k, 3 * 86_400);
  if (DAILY_CAP !== null && total > DAILY_CAP) {
    await redis("DECRBY", k, credits);
    return false;
  }
  return true;
}

// Corrects a booking once the provider reports what it really charged (refunds, failures).
export async function adjust(delta: number, day: string) {
  if (delta) await redis("INCRBY", key(day), delta);
}
