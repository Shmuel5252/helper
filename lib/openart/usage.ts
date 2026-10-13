import "server-only";
import { israelDay } from "./day";
import { redis } from "./redis";

// Daily credit cap, tracked per Israel calendar day in Redis.
export const DAILY_CAP = Number(process.env.OPENART_DAILY_CREDIT_CAP) || 200;
const key = (day = israelDay()) => `openart:spent:${day}`;

export async function usage() {
  const spent = Number((await redis<string | null>("GET", key())) ?? 0);
  return { spent, cap: DAILY_CAP, remaining: Math.max(0, DAILY_CAP - spent) };
}

// Atomically books `credits` for today; refuses (and undoes) if that would pass the cap.
export async function reserve(credits: number): Promise<boolean> {
  const k = key();
  const total = Number(await redis("INCRBY", k, credits));
  await redis("EXPIRE", k, 3 * 86_400);
  if (total > DAILY_CAP) {
    await redis("DECRBY", k, credits);
    return false;
  }
  return true;
}

// Corrects a booking once the provider reports what it really charged (refunds, failures).
export async function adjust(delta: number, day: string) {
  if (delta) await redis("INCRBY", key(day), delta);
}
