import OpenAI from "openai";
import { ERROR_MARK, prepareHistory } from "@/lib/chat";
import { hebrewError } from "@/lib/errors";
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

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const messages = prepareHistory(body?.messages);
  if (!messages) return errorResponse(400, "ההודעה ריקה או לא תקינה.");

  // Only allowlisted entries; an unknown key silently gets the default. Never a client model id.
  const entry = resolveModel(MODELS, body?.modelKey);
  if (!API_KEY || !entry) {
    return errorResponse(500, "האתר עדיין לא הוגדר עד הסוף (חסר מפתח או מודל). פנו למנהל האתר.");
  }
  const errorOpts = { alternatives: MODELS.length > 1 };

  let stream;
  try {
    stream = await client.chat.completions.create(
      {
        model: entry.model,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
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
