import "server-only";
import { parseModels } from "@/lib/models";

// Provider-neutral names; the original NVIDIA_* names still work as a fallback.
const env = (name: string) => process.env[`AI_${name}`] || process.env[`NVIDIA_${name}`];

export const API_KEY = env("API_KEY");
export const BASE_URL = env("BASE_URL") || "https://integrate.api.nvidia.com/v1";

// Allowlisted model entries (AI_MODELS), or a single entry from AI_MODEL.
// AI_REASONING_EFFORT is the default effort; an empty value means "don't send the parameter".
export const MODELS = parseModels(process.env.AI_MODELS, {
  model: env("MODEL"),
  effort: process.env.AI_REASONING_EFFORT ?? "none",
});
