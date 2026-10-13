import { generate } from "@/lib/openart/media";
import { readJson, respond } from "@/lib/openart/route";

export const maxDuration = 60; // reference uploads can take a few seconds

// Starts a generation ({ kind, key, prompt, credits, image? }) and returns its job id at once.
// `credits` must equal a fresh quote; the daily cap is checked and booked atomically.
export async function POST(request: Request) {
  const body = await readJson(request);
  return respond(() => generate(body));
}
