// Mock OpenAI-compatible server for local testing (no real NVIDIA key needed).
// Run: node tests/mock-nvidia.mjs   then start the app with AI_BASE_URL=http://localhost:4010/v1
import http from "node:http";

const ANSWERS = {
  // Reasoning-model style output; 6-char chunks split both tags across chunks.
  חשיבה: "<think>The user wants a short answer. Let me reason step by step.</think>\n\nהנה התשובה, בלי החשיבה.",
  פסקה:
    "שלום! אני עוזר אישי שמדבר עברית. אפשר לשאול אותי כל שאלה, לבקש עזרה בניסוח הודעות, בתכנון טיולים או בהסבר של נושאים מסובכים במילים פשוטות. אני משתדל לענות בצורה ברורה וקצרה.",
  "סוף אנגלית":
    "הגרסה החדשה של הספרייה נקראת React 19. כדאי לעדכן אותה לפני שמתחילים פרויקט חדש עם Next.js 16.",
  English:
    "This is a pure English answer. It should render left-to-right, with the period at the end of the sentence.",
  רשימות:
    "הנה רשימת קניות:\n\n- חלב ולחם\n- ביצים (12 יחידות)\n- ירקות לסלט\n\nושלבי הכנה:\n\n1. מחממים את התנור ל-180 מעלות.\n2. מערבבים את כל החומרים בקערה.\n3. אופים 25 דקות.",
  קוד:
    "כדי להדפיס הודעה משתמשים בפונקציה `console.log` בתוך הקוד:\n\n```js\nfunction greet(name) {\n  console.log(`Hello, ${name}!`);\n  return name.length;\n}\n```\n\nהפונקציה מחזירה את האורך של `name` כמספר.",
};

const LONG = Array.from(
  { length: 60 },
  (_, i) => `זו שורה מספר ${i + 1} בתשובה ארוכה שנועדה לבדוק את כפתור העצירה.`,
).join("\n\n");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function chunk(content) {
  return `data: ${JSON.stringify({
    id: "mock",
    object: "chat.completion.chunk",
    created: 0,
    model: "mock",
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  })}\n\n`;
}

http
  .createServer(async (req, res) => {
    if (req.method !== "POST" || !req.url.endsWith("/chat/completions")) {
      res.writeHead(404).end();
      return;
    }
    let raw = "";
    for await (const c of req) raw += c;
    const body = JSON.parse(raw);
    const last = body.messages.at(-1).content;
    console.log(`[mock] model=${body.model} messages=${body.messages.length} last=${JSON.stringify(last.slice(0, 40))}`);

    if (last.includes("מכסה")) {
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "rate limited" } }));
      return;
    }

    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const slow = last.includes("ארוך");
    const text = slow
      ? LONG
      : last.includes("ניתוק")
        ? "התחלתי לענות ואז"
        : (Object.entries(ANSWERS).find(([k]) => last.includes(k))?.[1] ?? `קיבלתי: ${last}`);

    for (let i = 0; i < text.length; i += 6) {
      if (res.destroyed) return;
      res.write(chunk(text.slice(i, i + 6)));
      await sleep(slow ? 40 : 8);
    }
    if (last.includes("ניתוק")) {
      res.destroy(); // simulate the upstream dropping mid-stream
      return;
    }
    res.end("data: [DONE]\n\n");
  })
  .listen(4010, () => console.log("[mock] listening on http://localhost:4010/v1"));
