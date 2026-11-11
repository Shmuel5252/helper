import 'server-only';
import {createHash,type JsonWebKey} from 'node:crypto';
import {falInput,submitFal,storedFalJob,falFailure,FalError,falOutput,readLimited,verifyFalSignature} from '../fal';
import {ArchiveError} from './validation';
import {assetsFor,db,getAssetBytes,putAsset} from './store';
import {outputAsset,validMedia} from './worker-contract';
import type {ArchiveTurn,TurnInput} from './types';

export const falSelected=()=>process.env.MEDIA_PROVIDER==='fal';
export function falReady(){return process.env.FAL_MEDIA_ENABLED==='true'&&!!process.env.FAL_KEY&&!!publicOrigin();}
function publicOrigin(){
  try{const u=new URL(process.env.FAL_PUBLIC_ORIGIN??'');return u.protocol==='https:'&&!u.username&&!u.password&&u.pathname==='/'&&!u.search&&!u.hash?u.origin:null;}catch{return null;}
}
const find=async(id:string)=>(await db<ArchiveTurn[]>('archive_turns',`id=eq.${id}&limit=1`))[0];
const update=async(id:string,fields:Partial<ArchiveTurn>)=>{
  const rows=await db<ArchiveTurn[]>('archive_turns',`id=eq.${id}&status=in.(starting,running,uncertain)`,'PATCH',{...fields,checked_at:new Date().toISOString()});
  return rows[0]??await find(id);
};
function kindOf(t:{model_key:string}){return t.model_key==='fal-video-v1'?'video' as const:'image' as const;}

export async function startFal(owner:string,input:TurnInput):Promise<ArchiveTurn>{
  if(!falSelected()||!falReady())throw new ArchiveError('שירות היצירה החדש עדיין לא הופעל.',503);
  const attachments=await assetsFor(input.conversationId);
  const files=input.assets.map(id=>attachments.find(a=>a.id===id));
  if(files.some(a=>!a||!['image/jpeg','image/png','image/webp'].includes(a.mime)))throw new ArchiveError('אפשר לצרף תמונות בלבד.');
  const kind=kindOf({model_key:input.modelKey});
  if(kind==='video'&&files.length>1)throw new ArchiveError('אפשר לצרף תמונה אחת לסרטון.');
  // Prepare inputs before reserving a turn or sending a billable request.
  const images=await Promise.all(files.map(async a=>{const bytes=await getAssetBytes(a!);return `data:${a!.mime};base64,${bytes.toString('base64')}`;}));
  const request=falInput(kind,input.text||'הנפש את התמונה בתנועה טבעית',images);
  const hash=createHash('sha256').update(JSON.stringify([input.conversationId,input.modelKey,input.text,input.assets])).digest('hex');
  const created=await db<boolean>('rpc/archive_begin_turn','','POST',{p_owner:owner,p_conversation:input.conversationId,p_id:input.id,p_hash:hash,p_model:input.modelKey,p_input:input.text,p_assets:input.assets});
  if(!created)return find(input.id); // Same request ID can never incur a second generation.
  let submitted=false;
  try{
    const hook=new URL('/api/fal/webhook',publicOrigin()!);hook.searchParams.set('turn',input.id);
    submitted=true;
    const job=await submitFal(process.env.FAL_KEY!,request,hook.href);
    return await update(input.id,{provider_id:JSON.stringify(job),status:'running'});
  }catch(error){
    const definite=!submitted||error instanceof FalError&&error.rejected;
    const message=error instanceof ArchiveError||error instanceof FalError?error.message:'החיבור לשירות היצירה נקטע. אפשר לבדוק את המצב שוב.';
    return update(input.id,{status:definite?'failed':'uncertain',error:message});
  }
}
export async function refreshFal(original:ArchiveTurn):Promise<ArchiveTurn>{
  const turn=await find(original.id); // Re-read to avoid a stale poll overwriting completion.
  if(!turn||!['starting','running','uncertain'].includes(turn.status))return turn??original;
  const job=storedFalJob(turn.provider_id);
  if(!job){
    if(Date.now()-Date.parse(turn.created_at)>90000&&turn.status==='starting')return update(turn.id,{status:'uncertain',error:'לא התקבל אישור לשליחה. הבקשה לא תישלח שוב אוטומטית.'});
    return turn;
  }
  if(!process.env.FAL_KEY)throw new ArchiveError('חיבור שירות היצירה דורש חידוש.',503);
  const headers={Authorization:'Key '+process.env.FAL_KEY};
  const check=await fetch(job.statusUrl,{headers,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(12000)});
  if(!check.ok){
    if(check.status===404||check.status===410)return update(turn.id,{status:'uncertain',error:'התוצאה אינה זמינה כרגע. הבקשה לא תישלח שוב אוטומטית.'});
    throw new ArchiveError(falFailure(check.status,await check.json().catch(()=>null)).message,503);
  }
  const state=await check.json();
  if(state.status!=='COMPLETED'){
    if(!['IN_QUEUE','IN_PROGRESS'].includes(state.status))throw new ArchiveError('לא התקבל עדכון תקין משירות היצירה.',503);
    if(Date.now()-Date.parse(turn.created_at)>24*3600000)return update(turn.id,{status:'uncertain',error:'היצירה מתעכבת. הבקשה לא תישלח שוב אוטומטית.'});
    // Keep the card stable during queue/processing transitions and connection loss.
    return update(turn.id,{status:'running'});
  }
  if(state.error)return update(turn.id,{status:'failed',error:falFailure(422,state).message});
  const response=await fetch(job.responseUrl,{headers,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok){
    const e=falFailure(response.status,await response.json().catch(()=>null));
    if([400,422].includes(response.status))return update(turn.id,{status:'failed',error:e.message});
    throw new ArchiveError(e.message,503);
  }
  const result=await response.json();
  let output;
  try{output=falOutput(kindOf(turn),result);}catch(e){return update(turn.id,{status:'failed',error:e instanceof FalError?e.message:'לא התקבל קובץ תקין.'});}
  // No Authorization header ever travels to media hosts; redirects are rejected.
  const download=await fetch(output.url,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(25000)});
  let bytes:Buffer;
  try{bytes=await readLimited(download,52428800);}catch(e){
    if(e instanceof FalError&&e.rejected)return update(turn.id,{status:'failed',error:e.message});
    throw e; // Transient download/storage failure retains the provider request for recovery.
  }
  if(!validMedia(bytes,output.mime))return update(turn.id,{status:'failed',error:'התקבל קובץ שלא ניתן לפתוח.'});
  const file=outputAsset(turn.id,output.mime,bytes.length,createHash('sha256').update(bytes).digest('hex'));
  // Deterministic object ID makes duplicate webhook/poll deliveries idempotent.
  // Completion is written only after both file and metadata have been persisted.
  await putAsset({id:file.id,conversation_id:turn.conversation_id,name:file.name,mime:file.mime,size:file.size},bytes);
  return update(turn.id,{status:'completed',error:null,output:[{type:kindOf(turn),assetId:file.id}]});
}

let jwks:{keys:JsonWebKey[];at:number}|undefined;
export async function falWebhook(headers:Headers,raw:Buffer,id:string){
  if(!jwks||Date.now()-jwks.at>3600000){
    const r=await fetch('https://rest.fal.ai/.well-known/jwks.json',{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
    if(!r.ok)throw new ArchiveError('לא ניתן לאמת את העדכון.',503);
    const data=await r.json();if(!Array.isArray(data.keys))throw new ArchiveError('לא ניתן לאמת את העדכון.',503);
    jwks={keys:data.keys,at:Date.now()};
  }
  if(!verifyFalSignature(headers,raw,jwks.keys))throw new ArchiveError('Invalid signature',401);
  let body;try{body=JSON.parse(raw.toString());}catch{throw new ArchiveError('Invalid body');}
  const turn=await find(id);
  if(!turn)return; // Explicit owner deletion is never resurrected by a callback.
  if(!turn.model_key.startsWith('fal-'))throw new ArchiveError('Request mismatch',409);
  const job=storedFalJob(turn.provider_id);
  if(!job)throw new ArchiveError('Submission acknowledgement pending',503);
  const signedId=headers.get('x-fal-webhook-request-id');
  if(body.request_id!==job.requestId||(signedId!==body.request_id&&signedId!==body.gateway_request_id))throw new ArchiveError('Request mismatch',409);
  const settled=await refreshFal(turn);
  if(settled.status!=='completed'&&settled.status!=='failed')throw new ArchiveError('Result not archived yet',503);
}
