import 'server-only';
import { cookies } from 'next/headers';
import { createHash, randomBytes } from 'node:crypto';
import { ADMIN_COOKIE, isAdmin } from '@/lib/auth';
import { ArchiveError } from './validation';

const COOKIE = 'ai_chat_device';
export async function deviceOwner(create=false): Promise<string> {
  const jar = await cookies();
  let token=jar.get(COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    if (!create) throw new ArchiveError('השיחה אינה זמינה בדפדפן הזה.',403);
    token=randomBytes(32).toString('hex');
    jar.set(COOKIE,token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:31536000});
  }
  return createHash('sha256').update(token).digest('hex');
}
export async function admin() { return isAdmin((await cookies()).get(ADMIN_COOKIE)?.value); }
export function sameOrigin(request:Request) {
  const origin=request.headers.get('origin');
  if (origin && origin!==new URL(request.url).origin) throw new ArchiveError('בקשה ממקור לא מורשה.',403);
  if (request.headers.get('sec-fetch-site')==='cross-site') throw new ArchiveError('בקשה ממקור לא מורשה.',403);
}
