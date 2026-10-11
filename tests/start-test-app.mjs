// Starts the built app on :3101 against the mock AI server, with test model options.
// Env is set here (not in the shell) so the Hebrew labels survive on every OS.
// Run: npm run build && npm run mock:nvidia & node tests/start-test-app.mjs
import { spawn } from "node:child_process";

const env = {
  ...process.env,
  ACCESS_CODE: "test-code-123",
  AI_API_KEY: "mock",
  AI_MODEL: "mock-model",
  AI_BASE_URL: "http://localhost:4010/v1",
  AI_REASONING_EFFORT: "none",
  AI_MODELS: [
    "fast|mock-fast|מהיר|לרוב השאלות|none|1",
    "deep|mock-deep|מעמיק|לשאלות מורכבות, איטי יותר|medium|1",
    "deep2|mock-deep|יסודי|אותו מודל, חשיבה מלאה|high|1", // shares mock-deep's quota group

    "text|mock-text|טקסט בלבד|בלי תמונות|none|0",
  ].join(","),
};

spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", process.env.PORT ?? "3101"], {
  env,
  stdio: "inherit",
});
