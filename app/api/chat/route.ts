import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { ERROR_MARK, prepareHistory, type ChatMessage } from "@/lib/chat";
import { hebrewError } from "@/lib/errors";
import { findImageError, IMAGE_ERRORS, MAX_BODY_BYTES } from "@/lib/images";
import { resolveModel } from "@/lib/models";
import { API_KEY, BASE_URL, MODELS } from "@/lib/serverConfig";
import { SYSTEM_PROMPT } from "@/lib/systemPrompt";
import { createThinkFilter } from "@/lib/think";

export const maxDuration = 60;

const client = new OpenAI({
  apiKey: API_KEY ?? "missing",
  baseURL: BASE_URL,
  timeout: 25_000, // until the first byte; with one retry this stays under maxDuration
  maxRetries: 1,
});

function errorResponse(status: number, error: string) {
  return Response.json({ error }, { status });
}

// OpenAI-compatible shape: images go as a content array of text + image_url (data URL) parts.
function toProvider(m: ChatMessage): ChatCompletionMessageParam {
  if (m.role === "assistant" || !m.images) return { role: m.role, content: m.content };
  return {
    role: "user",
    content: [
      { type: "text", text: m.content },
      ...m.images.map((url) => ({ type: "image_url" as const, image_url: { url } })),
    ],
  };
}

export async function POST(request: Request) {
  const raw = await request.text().catch(() => "");
  if (raw.length > MAX_BODY_BYTES) return errorResponse(413, IMAGE_ERRORS.body);
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return errorResponse(400, "ההודעה ריקה או לא תקינה.");
  }

  // Only allowlisted entries; an unknown key silently gets the default. Never a client model id.
  const entry = resolveModel(MODELS, body?.modelKey);
  if (!API_KEY || !entry) {
    return errorResponse(500, "האתר עדיין לא הוגדר עד הסוף (חסר מפתח או מודל). פנו למנהל האתר.");
  }

  const imageError = findImageError(body?.messages);
  if (imageError) return errorResponse(400, imageError);
  const messages = prepareHistory(body?.messages, { vision: entry.vision });
  if (!messages) return errorResponse(400, "ההודעה ריקה או לא תקינה.");
  // Quotas are per model, so only an option on another model is a real alternative.
  const errorOpts = { alternatives: MODELS.some((m) => m.model !== entry.model) };

  let stream;
  try {
    stream = await client.chat.completions.create(
      {
        model: entry.model,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages.map(toProvider)],
        stream: true,
        temperature: 0.6,
        // Hidden reasoning tokens count toward this limit, so leave room beyond the visible answer.
        max_tokens: 8192,
        // How long reasoning models think first (less = faster first token). "" = provider default.
        ...(entry.effort ? { reasoning_effort: entry.effort } : {}),
      },
      { signal: request.signal },
    );
  } catch (e) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    console.error("AI request failed:", e);
    return errorResponse(502, hebrewError(e, errorOpts));
  }

  const enc = new TextEncoder();
  const out = new ReadableStream<Uint8Array>({
    async start(controller) {
      const think = createThinkFilter();
      try {
        for await (const chunk of stream) {
          const text = think.push(chunk.choices[0]?.delta?.content ?? "");
          if (text) controller.enqueue(enc.encode(text));
        }
        const rest = think.flush();
        if (rest) controller.enqueue(enc.encode(rest));
      } catch (e) {
        if (!request.signal.aborted) {
          console.error("AI stream failed:", e);
          controller.enqueue(enc.encode(ERROR_MARK + hebrewError(e, errorOpts)));
        }
      }
      try {
        controller.close();
      } catch {
        // already closed by a cancelled client
      }
    },
    cancel() {
      stream.controller.abort();
    },
  });

  return new Response(out, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
