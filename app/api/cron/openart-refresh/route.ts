import { accessToken, NotConnected } from "@/lib/openart/connection";

// Daily keep-alive (vercel.json cron): one forced refresh so the rotating refresh token never
// idles out. Vercel sends `Authorization: Bearer $CRON_SECRET`.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    await accessToken({ failed: "force" });
    return Response.json({ ok: true, refreshedAt: new Date().toISOString() });
  } catch (e) {
    const notConnected = e instanceof NotConnected;
    console.error("OpenArt keep-alive failed:", (e as Error).message);
    return Response.json({ ok: false, reason: notConnected ? "not connected" : "refresh failed" }, { status: notConnected ? 409 : 502 });
  }
}
