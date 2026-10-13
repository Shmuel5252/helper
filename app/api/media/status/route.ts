import { jobStatus } from "@/lib/openart/media";
import { respond } from "@/lib/openart/route";

// One short status check per call; the browser polls (every ~4s or as OpenArt suggests).
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  return respond(() => jobStatus(id));
}
