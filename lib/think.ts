const OPEN = "<think>";
const CLOSE = "</think>";

// Length of the longest suffix of `s` that is a proper prefix of `tag`
// (a tag that may be split across chunks).
function partialTag(s: string, tag: string): number {
  for (let k = Math.min(tag.length - 1, s.length); k > 0; k--) if (s.endsWith(tag.slice(0, k))) return k;
  return 0;
}

// Streaming filter that removes <think>…</think> blocks (reasoning models emit them),
// even when a tag is split across chunks. Whitespace right after a block is dropped too.
export function createThinkFilter() {
  let buf = "";
  let inThink = false;
  let trimStart = false;

  const emit = (s: string) => {
    if (!trimStart) return s;
    const t = s.trimStart();
    if (t) trimStart = false;
    return t;
  };

  return {
    push(chunk: string): string {
      buf += chunk;
      let out = "";
      for (;;) {
        if (inThink) {
          const end = buf.indexOf(CLOSE);
          if (end === -1) {
            buf = buf.slice(buf.length - partialTag(buf, CLOSE));
            return out;
          }
          buf = buf.slice(end + CLOSE.length);
          inThink = false;
          trimStart = true;
        } else {
          const start = buf.indexOf(OPEN);
          if (start === -1) {
            const keep = partialTag(buf, OPEN);
            out += emit(buf.slice(0, buf.length - keep));
            buf = buf.slice(buf.length - keep);
            return out;
          }
          out += emit(buf.slice(0, start));
          buf = buf.slice(start + OPEN.length);
          inThink = true;
        }
      }
    },
    flush(): string {
      const rest = inThink ? "" : emit(buf);
      buf = "";
      return rest;
    },
  };
}
