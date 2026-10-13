import "server-only";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, isAdmin } from "@/lib/auth";

export async function requireAdmin(): Promise<Response | null> {
  if (!process.env.ADMIN_CODE) return new Response(null, { status: 404 });
  const jar = await cookies();
  return (await isAdmin(jar.get(ADMIN_COOKIE)?.value)) ? null : new Response("Forbidden", { status: 403 });
}

// OAuth comes back to the same origin the admin is using (localhost or production).
export const callbackUrl = (request: Request) => `${new URL(request.url).origin}/api/admin/openart/callback`;
