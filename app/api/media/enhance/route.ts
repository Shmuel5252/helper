import OpenAI, { APIError } from "openai";
import { classifyAiError } from "@/lib/errors";
import type { ModelEntry } from "@/lib/models";
import {
  cleanEnhanced,
  enhanceSystemPrompt,
  fallbackNote,
  fallbackReason,
  promptModels,
  type FailureKind,
} from "@/lib/openart/enhance";
import { readJson } from "@/lib/openart/route";
import { API_KEY, BASE_URL, MODELS } from "@/lib/serverConfig";
import { createThinkFilter } from "@/lib/think";

export const maxDuration = 30;

const client = new OpenAI({ apiKey: API_KEY ?? "missing", baseURL: BASE_URL, maxRetries: 0 });
const CHAIN = promptModels(MODELS, process.env.AI_PROMPT_MODELS);
// Per model attempt, and for the whole chain (inside maxDuration). The attempt time is a knob:
// a short request normally answers in 1-3 s, an overloaded model may never answer.
const ATTEMPT_MS = Number(process.env.AI_PROMPT_TIMEOUT_MS) || 10_000;
const TOTAL_MS = 25_000;

// Same classification as the chat (lib/errors.ts): a daily quota is "quota"; a per-minute limit,
// overload, timeout or dropped connection is "temporary" (worth trying the next model).
function failureKind(e: unknown, timedOut: boolean): FailureKind {
  if (timedOut) return "temporary";
  const kind = classifyAiError(e);
  if (kind === "quota") return "quota";
  return kind === "rate" || kind === "temporary" || kind === "timeout" || kind === "network" ? "temporary" : "other";
}

async function translate(entry: ModelEntry, system: string, prompt: string, signal: AbortSignal): Promise<string> {
  const stream = await client.chat.completions.create(
    {
      model: entry.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      stream: true,
      temperature: 0.3,
      max_tokens: 1024, // hidden reasoning tokens count too
      ...(entry.effort ? { reasoning_effort: entry.effort } : {}),
    },
    { signal },
  );
  const think = createThinkFilter();
  let text = "";
  for await (const chunk of stream) text += think.push(chunk.choices[0]?.delta?.content ?? "");
  return cleanEnhanced(text + think.flush());
}

// { kind, prompt, withImage } → { prompt } in English via the chat models in AI_PROMPT_MODELS,
// trying the next one on any failure. Never fails the flow: if all fail it returns the original
// prompt with a Hebrew note saying why, and generation goes on with what the user wrote.
export async function POST(request: Request) {
  const body = await readJson(request);
  const kind = body?.kind === "video" ? "video" : "image";
  const original = typeof body?.prompt === "string" ? body.prompt.trim().slice(0, 2000) : "";
  if (!original) return Response.json({ error: "כתבו תיאור קצר של מה ליצור." }, { status: 400 });

  const system = enhanceSystemPrompt(kind, !!body?.withImage);
  const deadline = Date.now() + TOTAL_MS;
  const kinds: FailureKind[] = [];
  for (const entry of API_KEY ? CHAIN : []) {
    const left = deadline - Date.now();
    if (left < 1000 || request.signal.aborted) break;
    const timer = AbortSignal.timeout(Math.min(ATTEMPT_MS, left));
    try {
      const prompt = await translate(entry, system, original, AbortSignal.any([request.signal, timer]));
      if (prompt) return Response.json({ prompt, model: entry.key });
      kinds.push("other"); // empty answer
    } catch (e) {
      if (request.signal.aborted) return new Response(null, { status: 499 });
      const k = failureKind(e, timer.aborted);
      kinds.push(k);
      // Error type only: never the prompt or the provider's message.
      console.error("Prompt enhancement failed:", entry.key, k, timer.aborted ? "timeout" : e instanceof APIError ? (e.status ?? "-") : "-");
    }
  }
  const reason = fallbackReason(kinds);
  return Response.json({ prompt: original, fallback: true, reason, note: fallbackNote(reason) });
}
