export const MAX_MESSAGES = 20;
export const MAX_CHARS = 4000;

// Separates streamed answer text from a trailing error message.
export const ERROR_MARK = "\u0000";

export type ChatMessage = { role: "user" | "assistant"; content: string };

// Validates client-sent history and shapes it for the model:
// keeps the last MAX_MESSAGES, caps each message at MAX_CHARS,
// drops leading assistant turns and merges consecutive same-role turns
// (some NVIDIA-hosted models reject non-alternating roles).
// Returns null when there is nothing valid to answer.
export function prepareHistory(input: unknown): ChatMessage[] | null {
  if (!Array.isArray(input)) return null;

  const valid = input
    .filter(
      (m): m is ChatMessage =>
        !!m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim() !== "",
    )
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));

  while (valid[0]?.role === "assistant") valid.shift();

  const out: ChatMessage[] = [];
  for (const m of valid) {
    const prev = out[out.length - 1];
    if (prev?.role === m.role) prev.content += "\n\n" + m.content;
    else out.push(m);
  }

  return out.length && out[out.length - 1].role === "user" ? out : null;
}

export const MSG_GENERIC = "משהו השתבש. נסו שוב בעוד רגע.";
