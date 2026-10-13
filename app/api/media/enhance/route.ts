import OpenAI from "openai";
import { resolveModel } from "@/lib/models";
import { cleanEnhanced, ENHANCE_FALLBACK_NOTE, enhanceSystemPrompt } from "@/lib/openart/enhance";
import { readJson } from "@/lib/openart/route";
import { API_KEY, BASE_URL, MODELS } from "@/lib/serverConfig";
import { createThinkFilter } from "@/lib/think";

export const maxDuration = 30;

const client = new OpenAI({ apiKey: API_KEY ?? "missing", baseURL: BASE_URL, timeout: 15_000, maxRetries: 0 });

// { kind, prompt, withImage } → { prompt } in English via the chat model (the default option).
// Never fails the flow: on any error (quota, timeout, no key) it returns the original prompt
// with a Hebrew note, and generation goes on with what the user wrote.
export async function POST(request: Request) {
  const body = await readJson(request);
  const kind = body?.kind === "video" ? "video" : "image";
  const original = typeof body?.prompt === "string" ? body.prompt.trim().slice(0, 2000) : "";
  if (!original) return Response.json({ error: "כתבו תיאור קצר של מה ליצור." }, { status: 400 });

  const fallback = () => Response.json({ prompt: original, fallback: true, note: ENHANCE_FALLBACK_NOTE });
  const entry = resolveModel(MODELS, undefined);
  if (!API_KEY || !entry) return fallback();
  try {
    const stream = await client.chat.completions.create(
      {
        model: entry.model,
        messages: [
          { role: "system", content: enhanceSystemPrompt(kind, !!body?.withImage) },
          { role: "user", content: original },
        ],
        stream: true,
        temperature: 0.3,
        max_tokens: 1024, // hidden reasoning tokens count too
        ...(entry.effort ? { reasoning_effort: entry.effort } : {}),
      },
      { signal: request.signal },
    );
    const think = createThinkFilter();
    let text = "";
    for await (const chunk of stream) text += think.push(chunk.choices[0]?.delta?.content ?? "");
    const prompt = cleanEnhanced(text + think.flush());
    return prompt ? Response.json({ prompt }) : fallback();
  } catch (e) {
    console.error("Prompt enhancement failed:", (e as Error)?.message);
    return fallback();
  }
}
