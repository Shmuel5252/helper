import { connection } from "next/server";
import { publicModels } from "@/lib/models";
import { MODELS } from "@/lib/serverConfig";

// The model options the browser may show: key, label, description and vision flag only.
export async function GET() {
  // Request time, not build time: the list must follow the server's current AI_MODELS.
  await connection();
  return Response.json({ models: publicModels(MODELS) }, { headers: { "Cache-Control": "no-store" } });
}
