import { quote } from "@/lib/openart/media";
import { readJson, respond } from "@/lib/openart/route";

// Exact credit cost for an allowlisted option ({ kind, key, withImage }), before generating.
export async function POST(request: Request) {
  const body = await readJson(request);
  return respond(() => quote(body));
}
