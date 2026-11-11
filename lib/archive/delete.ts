import 'server-only';
import { BUCKET, db, supabase } from './store';
import { ArchiveError } from './validation';

type Cleanup = {id:string;paths:string[]};
export async function cleanDeletedFiles(id?:string) {
  const jobs=await db<Cleanup[]>('archive_deletions',`${id?`id=eq.${id}&`:''}not_before=lte.${encodeURIComponent(new Date().toISOString())}&order=created_at.asc&limit=20`);
  let failed=0;
  for(const job of jobs){
    try{
      for(let start=0;start<job.paths.length;start+=100){
        await supabase(`/storage/v1/object/${BUCKET}`,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefixes:job.paths.slice(start,start+100)})});
      }
      await db('archive_deletions',`id=eq.${job.id}`,'DELETE');
    }catch{failed++;} // Durable queue is retried by the existing archive cron.
  }
  return {checked:jobs.length,failed};
}

export async function deleteConversation(id:string) {
  const result=await db<string>('rpc/archive_delete_conversation','','POST',{p_id:id});
  if(result==='busy')throw new ArchiveError('יש יצירה בתהליך. אפשר למחוק את השיחה כשהיא תסתיים.',409);
  if(result!=='deleted')throw new ArchiveError('לא הצלחנו למחוק את השיחה. נסו שוב.',503);
  // Metadata and cleanup work are committed together; retrying never loses file paths.
  await cleanDeletedFiles(id).catch(()=>undefined);
}
