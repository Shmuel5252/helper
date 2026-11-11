import { db } from '@/lib/archive/store';
import { refreshTurn } from '@/lib/archive/service';
import { json, failure } from '@/lib/archive/http';
import type { ArchiveTurn } from '@/lib/archive/types';
import { cleanDeletedFiles } from '@/lib/archive/delete';
export const maxDuration=60;
export async function GET(request:Request) {
  if(!process.env.CRON_SECRET || request.headers.get('authorization')!==`Bearer ${process.env.CRON_SECRET}`)return new Response(null,{status:401});
  try {
    const pending=await db<ArchiveTurn[]>('archive_turns','status=in.(starting,running)&order=checked_at.asc&limit=20');
    let settled=0; let failed=0;
    const results=await Promise.allSettled(pending.map(t=>refreshTurn(t)));
    for(const r of results) {if(r.status==='rejected')failed++;else if(!['running','starting'].includes(r.value.status))settled++;}
    const cleanup=await cleanDeletedFiles();
    return json({checked:pending.length,settled,failed,cleanup},failed||cleanup.failed?503:200);
  }catch(e){return failure(e);}
}
