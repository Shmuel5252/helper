import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { assetsFor, assetPath, BUCKET, db, getAssetBytes, supabase, turnsFor } from './store';
import { ArchiveError, modelFor } from './validation';
import { browserContext, browserPrompt, outputAsset, parseWorkerMessage, validMedia } from './worker-contract';
import type { ArchiveTurn, TurnInput } from './types';
type Job={id:string;phase:string;token:string;lease_until:string;source_url:string|null;file:ReturnType<typeof outputAsset>|null};
export async function browserHealth(){
  if(!process.env.GEMINI_WORKER_SECRET)return {ready:false,state:'offline'};
  try{
    const [h]=await db<{state:string;seen_at:string}[]>('archive_browser_health','id=eq.true');
    const fresh=!!h&&Date.now()-Date.parse(h.seen_at)<60_000;
    return {ready:fresh&&h.state==='ready',state:fresh?h.state:'offline'};
  }catch{return {ready:false,state:'offline'};}
}
export async function enqueueBrowser(owner:string,input:TurnInput) {
  if(!(await browserHealth()).ready)throw new ArchiveError('יצירה ב־Gemini אינה זמינה כרגע. נסו שוב בעוד רגע.',503);
  const attachments=await assetsFor(input.conversationId);
  if(input.assets.some(id=>!attachments.some(a=>a.id===id&&a.mime.startsWith('image/'))))throw new ArchiveError('אפשר לצרף תמונות בלבד ליצירה הזו.');
  const digest=createHash('sha256').update(JSON.stringify([input.conversationId,input.modelKey,input.text,input.assets])).digest('hex');
  await db('rpc/archive_browser_enqueue','','POST',{p_owner:owner,p_conversation:input.conversationId,p_id:input.id,p_hash:digest,p_model:input.modelKey,p_input:input.text,p_assets:input.assets});
  return (await db<ArchiveTurn[]>('archive_turns',`id=eq.${input.id}`))[0];
}
export async function refreshBrowser(turn:ArchiveTurn){
  if(['starting','running'].includes(turn.status))await db('rpc/archive_browser_expire','','POST',{});
  return (await db<ArchiveTurn[]>('archive_turns',`id=eq.${turn.id}`))[0]??turn;
}
const update=async(id:string,token:string,action:string,data:unknown={})=>{
  if(!await db<boolean>('rpc/archive_browser_update','','POST',{p_id:id,p_token:token,p_action:action,p_data:data}))throw new ArchiveError('Claim expired',409);
};
function storageURL(path:string){
  const base=process.env.SUPABASE_URL!.replace(/\/$/,'');
  // Storage returns a path relative to /storage/v1, never arbitrary external URLs.
  if(!path.startsWith('/object/'))throw new ArchiveError('Invalid storage URL',502);
  return base+'/storage/v1'+path;
}
export async function workerOperation(raw:unknown){
  const x=parseWorkerMessage(raw);
  if(x.action==='heartbeat'){
    await db('archive_browser_health','on_conflict=id','POST',{id:true,state:x.state,seen_at:new Date().toISOString()},'resolution=merge-duplicates,return=minimal');
    return {ok:true};
  }
  if(x.action==='claim'){
    const [job]=await db<Job[]>('rpc/archive_browser_claim','','POST',{p_token:randomUUID()});
    if(!job)return {job:null};
    const [turn]=await db<ArchiveTurn[]>('archive_turns',`id=eq.${job.id}`);
    const kind=modelFor(turn.model_key)!.kind;
    const baseJob={id:job.id,token:job.token,leaseUntil:job.lease_until,source:job.source_url,kind};
    if(job.source_url)return {job:{...baseJob,text:'',inputs:[]}};
    const [assets,history]=await Promise.all([assetsFor(turn.conversation_id),turnsFor(turn.conversation_id)]);
    const attachments=assets.filter(a=>turn.assets.includes(a.id));
    const inputs=[];
    for(const a of attachments){
      const result=await (await supabase(`/storage/v1/object/sign/${BUCKET}/${assetPath(a)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expiresIn:600})})).json();
      inputs.push({id:a.id,mime:a.mime,url:storageURL(result.signedURL)});
    }
    const context=browserContext(turn.conversation_id,history);
    return {job:{...baseJob,text:browserPrompt(context,kind,turn.input),inputs}};
  }
  const id=x.id!,token=x.token!;
  if(x.action==='response'){
    if(!await db<boolean>('rpc/archive_browser_response','','POST',{p_id:id,p_token:token,p_text:x.text}))throw new ArchiveError('Claim expired',409);
    return {ok:true};
  }
  if(['renew','submit','fail'].includes(x.action)){await update(id,token,x.action);return {ok:true};}
  if(x.action==='source'){await update(id,token,'source',{url:x.url});return {ok:true};}
  const [job]=await db<Job[]>('archive_browser_jobs',`id=eq.${id}&token=eq.${token}`);
  const [turn]=await db<ArchiveTurn[]>('archive_turns',`id=eq.${id}`);
  if(!job||!turn)throw new ArchiveError('Claim not found',409);
  if(x.action==='complete'&&job.phase==='done'&&turn.status==='completed')return {ok:true};
  await update(id,token,'renew');
  if(x.action==='reserve'){
    if((modelFor(turn.model_key)?.kind==='video')!==(x.mime==='video/mp4'))throw new ArchiveError('Wrong output kind');
    const file=outputAsset(id,x.mime!,x.size!,x.sha256!,x.text??'');
    await update(id,token,'reserve',file);
    const result=await (await supabase(`/storage/v1/object/upload/sign/${BUCKET}/${turn.conversation_id}/${file.id}`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).json();
    return {url:storageURL(result.url),assetId:file.id};
  }
  if(x.action==='complete'){
    if(!job.file)throw new ArchiveError('Output not reserved');
    const f=job.file;
    const bytes=await getAssetBytes({...f,conversation_id:turn.conversation_id});
    if(bytes.length!==f.size||!validMedia(bytes,f.mime)||createHash('sha256').update(bytes).digest('hex')!==f.sha256)throw new ArchiveError('Output verification failed',422);
    await update(id,token,'complete');return {ok:true};
  }
  throw new ArchiveError('Invalid action');
}
