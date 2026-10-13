import { connection } from "next/server";
import { mediaConfig } from "@/lib/openart/media";
import { respond } from "@/lib/openart/route";

// What the composer may offer: availability, allowlisted options (no model ids) and today's usage.
export async function GET() {
  await connection();
  return respond(mediaConfig);
}
