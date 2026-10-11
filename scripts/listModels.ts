// Prints the model ids available to AI_API_KEY at AI_BASE_URL. Run: npm run models
import OpenAI from "openai";

const env = (name: string) => process.env[`AI_${name}`] || process.env[`NVIDIA_${name}`];
const apiKey = env("API_KEY");
if (!apiKey) {
  console.error("AI_API_KEY is missing. Put it in .env.local");
  process.exit(1);
}

const client = new OpenAI({ apiKey, baseURL: env("BASE_URL") || "https://integrate.api.nvidia.com/v1" });
const ids: string[] = [];
for await (const model of client.models.list()) ids.push(model.id);
console.log(ids.sort().join("\n"));
console.log(`\n${ids.length} models`);
