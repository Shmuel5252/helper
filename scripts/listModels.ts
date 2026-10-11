// Prints the model ids available to NVIDIA_API_KEY. Run: npm run models
import OpenAI from "openai";

const apiKey = process.env.NVIDIA_API_KEY;
if (!apiKey) {
  console.error("NVIDIA_API_KEY is missing. Put it in .env.local");
  process.exit(1);
}

const client = new OpenAI({ apiKey, baseURL: "https://integrate.api.nvidia.com/v1" });
const ids: string[] = [];
for await (const model of client.models.list()) ids.push(model.id);
console.log(ids.sort().join("\n"));
console.log(`\n${ids.length} models`);
