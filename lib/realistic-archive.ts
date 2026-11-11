import 'server-only';
import {db,conversation,putAsset,supabase} from './archive/store';
import {ArchiveError} from './archive/validation';
import type {ArchiveTurn,ArchiveOutput} from './archive/types';
import type {ImageJob} from './realistic-image';
import {imageMetadata} from './realistic-image';

// Called at acceptance/completion, independently of deleting a chat in the browser.
// Existing rows and immutable asset IDs make delivery retries safe.
export async function syncImageArchive(job:ImageJob,requestedConversation?:string,bytes?:Buffer){
  const [existing]=await db<ArchiveTurn[]>('archive_turns',`id=eq.${job.id}&limit=1`);
  if(existing&&existing.model_key!=='realistic-image')throw new ArchiveError('מזהה הבקשה כבר בשימוש.',409);
  const cid=existing?.conversation_id??job.settings.archiveConversationId??requestedConversation??job.id;
  const deleted=await db<{id:string}[]>('archive_deleted_conversations',`id=eq.${cid}&limit=1`);
  if(deleted.length)return; // Respect an explicit administrator deletion from the archive itself.
  if(requestedConversation)await conversation(requestedConversation,job.owner);
  await db('archive_conversations','on_conflict=id','POST',{id:cid,owner:job.owner,title:job.input.trim().slice(0,120)||'תמונה',created_at:job.created_at},'resolution=ignore-duplicates,return=minimal');
  await conversation(cid,job.owner);
  if(existing?.status==='completed'&&existing.output.some(o=>o.type==='image'))return;
  const status=job.phase==='done'?'completed':['failed','uncertain'].includes(job.phase)?'failed':'running';
  if(existing?.status===status&&(status!=='completed'||existing.output.some(o=>o.type==='image')))return;
  const output:ArchiveOutput[]=[];
  if(status==='completed'){
    const png=bytes??Buffer.from(await(await supabase(`/storage/v1/object/realistic-images/${job.owner}/${job.id}.png`)).arrayBuffer());
    await putAsset({id:job.id,conversation_id:cid,name:'image.png',mime:'image/png',size:png.length},png);
    output.push({type:'image',assetId:job.id,realistic:imageMetadata(job)});
  }
  if(existing)await db('archive_turns',`id=eq.${job.id}`,'PATCH',{status,output,error:job.error??null,checked_at:job.updated_at});
  else await db('archive_turns','on_conflict=id','POST',{id:job.id,conversation_id:cid,model_key:'realistic-image',input_hash:job.request_hash,input:job.input,assets:job.settings.sourceAssetId?[job.settings.sourceAssetId]:[],status,output,error:job.error??null,created_at:job.created_at,checked_at:job.updated_at},'resolution=ignore-duplicates,return=minimal');
}

export async function backfillImageArchive(){
  if(process.env.IMAGE_MODE!=='cloud'||process.env.IMAGE_CLOUD_CONSENT!=='approved-v1')return;
  for(let offset=0;;offset+=100){
    const jobs=await db<ImageJob[]>('realistic_jobs',`order=created_at.asc,id.asc&limit=100&offset=${offset}`);
    const archived=jobs.length?await db<ArchiveTurn[]>('archive_turns',`id=in.(${jobs.map(j=>j.id).join(',')})&select=id,status,output`):[];
    for(const job of jobs){
      const saved=archived.find(t=>t.id===job.id);
      if(saved?.status==='completed'&&saved.output.some(o=>o.type==='image'))continue;
      if(saved&&saved.status===(['failed','uncertain'].includes(job.phase)?'failed':'running')&&job.phase!=='done')continue;
      await syncImageArchive(job);
    }
    if(jobs.length<100)break;
  }
}

export async function archiveOwnedImage(job:ImageJob,cid:string){
  if(process.env.IMAGE_MODE!=='cloud')throw new ArchiveError('שמירת תמונות בארכיון אינה זמינה במצב הזה.',409);
  await syncImageArchive(job,cid);
}
