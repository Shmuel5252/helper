import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// Starts the built app on :3101 against the mock AI server, with test model options.
// Env is set here (not in the shell) so the Hebrew labels survive on every OS.
// Run: npm run build && npm run mock:nvidia & node tests/start-test-app.mjs
import { spawn } from "node:child_process";

const env = {
  ...process.env,
  ACCESS_CODE: process.env.TEST_ACCESS_CODE ?? "test-code-123", // TEST_ACCESS_CODE= (empty) runs with the gate off
  AI_API_KEY: "mock",
  AI_MODEL: "mock-model",
  AI_BASE_URL: "http://localhost:4010/v1",
  AI_REASONING_EFFORT: "none",
  // OpenArt against tests/mock-openart.mjs (4020) and tests/mock-upstash.mjs (4030).
  OPENART_MCP_URL: "http://localhost:4020/mcp",
  OPENART_CDN_URL: "http://localhost:4020/cdn",
  KV_REST_API_URL: process.env.TEST_KV_URL ?? "http://localhost:4030",
  KV_REST_API_TOKEN: "test",
  OPENART_TOKEN_KEY: Buffer.alloc(32, 7).toString("base64"), // fixed test key
  ADMIN_CODE: "admin-test",
  CRON_SECRET: "cron-test",
  OPENART_DAILY_CREDIT_CAP: "200",
  AI_MODELS: process.env.TEST_AI_MODELS ?? [
    "fast|mock-fast|מהיר|לרוב השאלות|none|1",
    "deep|mock-deep|מעמיק|לשאלות מורכבות, איטי יותר|medium|1",
    "deep2|mock-deep|יסודי|אותו מודל, חשיבה מלאה|high|1", // shares mock-deep's quota group

    "text|mock-text|טקסט בלבד|בלי תמונות|none|0",
  ].join(","),
};

// Output goes to this console and to a log file, so tests can check what the server logs.
const port = process.env.PORT ?? "3101";
const LOG_FILE = path.join(os.tmpdir(), `ai-chat-app-${port}.log`);
const log = fs.createWriteStream(LOG_FILE);
const app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", port], {
  env,
  stdio: ["ignore", "pipe", "pipe"],
});
for (const out of [app.stdout, app.stderr]) {
  out.pipe(process.stdout);
  out.pipe(log);
}
