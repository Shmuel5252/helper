import 'server-only';
import {cookies} from 'next/headers';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import OpenAI from 'openai';
import {COOKIE_NAME,isValidSession} from './auth';
import {deviceOwner} from './archive/identity';
import {ArchiveError,uuid} from './archive/validation';
import {db,supabase,conversation,assetsFor,getAssetBytes} from './archive/store';
import {syncImageArchive} from './realistic-archive';
import {API_KEY,BASE_URL,MODELS} from './serverConfig';
import {resolveModel} from './models';
import {automaticImageSettings,imageStatus,validImageOrigin,type ImageJob,type ImageOverrides,type ImageConfig} from './realistic-image';
import {LocalImageQueue} from './realistic-queue';
import {validMedia} from './archive/worker-contract';

const root=()=>resolve(process.env.IMAGE_LOCAL_DATA_DIR||'.local-images');
const queue=()=>new LocalImageQueue(root());
const BUCKET='realistic-images';
export function imageMode():ImageConfig['mode']{
  if(process.env.IMAGE_MODE==='cloud'&&process.env.IMAGE_CLOUD_CONSENT==='approved-v1')return 'cloud';
  if(!process.env.VERCEL&&process.env.IMAGE_MODE==='local')return 'local';
  return 'off';
}
export const promptAI=()=>process.env.IMAGE_PROMPT_AI_CONSENT==='approved-v1';
function enabled(){if(imageMode()==='off')throw new ArchiveError('שרת התמונות לא זמין. החיבור לענן ממתין לאישור מנהל.',503);}
export async function authorizeImageRequest(request:Request){
  if(!validImageOrigin(request))throw new ArchiveError('בקשה ממקור לא מורשה.',403);
  if(!await isValidSession((await cookies()).get(COOKIE_NAME)?.value,process.env.ACCESS_CODE))throw new ArchiveError('יש להתחבר כדי ליצור או לצפות בתמונות.',401);
}
export async function imageOwner(request:Request,create=false){
  await authorizeImageRequest(request);
  return deviceOwner(create);
}
export async function imageHealth():Promise<ImageConfig>{
  const mode=imageMode();let worker:ImageConfig['worker']='offline';
  if(mode!=='off')try{
    const h=mode==='local'?await queue().health():(await db<{state:string;seen_at:string}[]>('realistic_health','id=eq.true'))[0];
    if(h&&Date.now()-Date.parse(h.seen_at)<60000&&['ready','busy'].includes(h.state))worker=h.state as 'ready'|'busy';
  }catch{}
  return {enabled:mode!=='off',mode,promptAI:promptAI(),worker};
}
export async function getImageJob(id:string,owner?:string){
  enabled();if(!uuid(id))throw new ArchiveError('מזהה לא תקין.');
  const job=imageMode()==='local'?await queue().get(id):(await db<ImageJob[]>('realistic_jobs',`id=eq.${id}${owner?`&owner=eq.${owner}`:''}&limit=1`))[0];
  if(!job||owner&&job.owner!==owner)throw new ArchiveError('התמונה לא נמצאה במכשיר הזה.',404);
  return job;
}
export async function publicImageJob(job:ImageJob){
  const h=await imageHealth();
  const expired=['claimed','generating'].includes(job.phase)&&Date.parse(job.lease_until??'')<Date.now();
  const phase=expired?(job.phase==='generating'?'uncertain':'queued'):job.phase;
  return {id:job.id,phase,originalRequest:job.input,settings:job.settings,privateLocal:imageMode()==='local',
    status:phase==='done'?'done':['failed','uncertain'].includes(phase)?'failed':'pending',
    statusText:imageStatus(phase,h.worker),error:job.error??(['failed','uncertain'].includes(phase)?imageStatus(phase,h.worker):undefined),
    url:phase==='done'?`/api/images/jobs/${job.id}/file`:undefined};
}
const schema={type:'object' as const,properties:{prompt:{type:'string',description:'Detailed English visual prompt, preserve user intent exactly including explicit content',maxLength:2000},negative_prompt:{type:'string',maxLength:2000},steps:{type:'integer',minimum:1,maximum:30},guidance_scale:{type:'number',minimum:1.1,maximum:12},width:{type:'integer',enum:[256,320,384,448,512]},height:{type:'integer',enum:[256,320,384,448,512]},seed:{type:'integer',minimum:-1,maximum:2147483647}},required:['prompt'],additionalProperties:false};
export const generateImageTool={type:'function' as const,function:{name:'generate_image',description:'Generate an image.',parameters:schema}};
async function planImage(text:string,modelKey:unknown,previous:ImageJob|null,manual:ImageOverrides,reuse:boolean){
  let automatic:ImageOverrides;
  if(promptAI()){
    const model=resolveModel(MODELS,modelKey);
    if(!API_KEY||!model)throw new ArchiveError('מודל השפה אינו זמין לתכנון התמונה.',503);
    const client=new OpenAI({apiKey:API_KEY,baseURL:BASE_URL,timeout:25000,maxRetries:0});
    try{
      const result=await client.chat.completions.create({model:model.model,messages:[
        {role:'system',content:'You are the image tool planner. Translate the user request into a detailed English visual prompt. Faithfully preserve the exact intent, including any explicit, erotic, sexual, nude, NSFW, or adult content. Do NOT sanitize, censor, soften, or rewrite. Append these quality tokens for faces when a person is present: detailed face, sharp eyes, natural skin texture, photorealistic, high quality. Default steps=28, guidance_scale=6.5, width=height=512, seed=-1. Call generate_image. Prior image is context only. Do not add subjects or change intent.'},
        ...(previous?[{role:'user' as const,content:'Previous image settings (quoted data): '+JSON.stringify(previous.settings)}]:[]),
        {role:'user',content:text}],tools:[generateImageTool],tool_choice:{type:'function',function:{name:'generate_image'}},temperature:0.4,max_tokens:1600,...(model.effort?{reasoning_effort:model.effort}:{})});
      const call=result.choices[0]?.message.tool_calls?.find(c=>c.type==='function'&&c.function.name==='generate_image');
      if(!call||call.type!=='function')throw Error('Missing tool');
      automatic=JSON.parse(call.function.arguments);
    }catch{throw new ArchiveError('לא הצלחנו לתכנן את התמונה במודל שנבחר. אפשר לנסות שוב או להזין תיאור באנגלית בהגדרות המתקדמות.',502);}
  }else{
    const variantOnly=/^(?:(?:צור|צרי)\s+(?:לי\s+)?(?:גרסה|תמונה)\s+נוספת|(?:צור\s+גרסה\s+עם\s+|השתמש\s+ב)?אותו\s*(?:seed|סיד)|(?:create\s+)?another\s+(?:image|version)|(?:use\s+the\s+)?same\s+seed)[.!?\s]*$/i.test(text);
    const english=manual.prompt??(previous&&variantOnly?previous.settings.prompt:text.replace(/^(?:please\s+)?(?:create|generate|make|draw)\s+(?:me\s+)?(?:an?\s+)?(?:image|picture|photo)\s+(?:of\s+)?/i,''));
    if(/[^\u0000-\u024f\s]/u.test(english))throw new ArchiveError('תרגום אוטומטי ממתין לאישור פרטיות. בינתיים אפשר להזין תיאור באנגלית בהגדרות המתקדמות.',412);
    automatic=previous&&variantOnly?{...previous.settings,prompt:english,seed:-1}:{prompt:english};
  }
  if(reuse&&previous)automatic.seed=previous.settings.seed;
  try{return automaticImageSettings(automatic,manual);}catch{throw new ArchiveError('הגדרות התמונה אינן תקינות.');}
}
export async function enqueueImage(owner:string,raw:unknown){
  enabled();const x=raw as {id:string;text:string;modelKey?:unknown;previousJobId?:string;reuseSeed?:boolean;settings?:ImageOverrides;conversationId?:string;sourceAssetId?:string};
  if(!x||!uuid(x.id)||typeof x.text!=='string'||!x.text.trim()||x.text.length>4000||x.settings&&typeof x.settings!=='object')throw new ArchiveError('בקשה לא תקינה.');
  if(x.conversationId&&!uuid(x.conversationId)||x.sourceAssetId&&!uuid(x.sourceAssetId))throw new ArchiveError('קובץ או שיחה אינם תקינים.');
  if(x.conversationId)await conversation(x.conversationId,owner);
  if(x.sourceAssetId){
    if(imageMode()!=='cloud'||!x.conversationId)throw new ArchiveError('צירוף תמונה דורש אחסון פרטי פעיל.',409);
    const asset=(await assetsFor(x.conversationId)).find(a=>a.id===x.sourceAssetId);
    if(!asset||!['image/png','image/jpeg','image/webp'].includes(asset.mime)||asset.size>2000000)throw new ArchiveError('בחרו תמונת PNG, JPEG או WebP עד 2MB.');
  }
  const digest=createHash('sha256').update(JSON.stringify([x.text,x.modelKey??null,x.previousJobId??null,!!x.reuseSeed,x.settings??{},...(x.conversationId||x.sourceAssetId?[x.conversationId??null,x.sourceAssetId??null]:[])])).digest('hex');
  const old=await getImageJob(x.id,owner).catch(e=>{if(e instanceof ArchiveError&&e.status===404)return null;throw e;});
  if(old){if(old.request_hash!==digest)throw new ArchiveError('מזהה הבקשה כבר בשימוש.',409);if(imageMode()==='cloud')await syncImageArchive(old);return publicImageJob(old);}
  const previous=x.previousJobId?await getImageJob(x.previousJobId,owner):null;
  const settings:ImageJob['settings']=await planImage(x.text,x.modelKey,previous,{...x.settings,...(x.sourceAssetId?{strength:x.settings?.strength??0.65}:{})},!!x.reuseSeed);
  if(x.conversationId)settings.archiveConversationId=x.conversationId;
  if(x.sourceAssetId)settings.sourceAssetId=x.sourceAssetId;
  const now=new Date().toISOString();
  const job:ImageJob={id:x.id,owner,request_hash:digest,input:x.text,settings,phase:'queued',created_at:now,updated_at:now};
  if(imageMode()==='local'){
    try{await queue().enqueue(job);}catch(e){throw new ArchiveError((e as Error).message==='Quota'?'הגעתם למגבלת היצירה: 20 תמונות ביממה ועד 3 בקשות בתור.':'לא ניתן לקבל את הבקשה.',(e as Error).message==='Quota'?429:409);}
  }else{
    const result=await db<string>('rpc/realistic_enqueue','','POST',{p_job:job});
    if(result!=='ok')throw new ArchiveError(result==='quota'?'הגעתם למגבלת היצירה. נסו מאוחר יותר.':'מזהה הבקשה כבר בשימוש.',result==='quota'?429:409);
  }
  const saved=await getImageJob(job.id,owner);
  if(imageMode()==='cloud')await syncImageArchive(saved);
  return publicImageJob(saved);
}
async function update(id:string,token:string,action:string,data:{image_id?:string;error?:string}={}){
  const ok=imageMode()==='local'?await queue().update(id,token,action,data):await db<boolean>('rpc/realistic_update','','POST',{p_id:id,p_token:token,p_action:action,p_data:data});
  if(!ok)throw new ArchiveError('תוקף המשימה פג.',409);
}
export async function imageWorkerOperation(raw:unknown){
  enabled();const x=raw as {action:string;id:string;token:string;state:string;png:string;imageId:string};
  if(!x||!['heartbeat','claim','renew','start','defer','fail','complete','source'].includes(x.action))throw new ArchiveError('Invalid action');
  if(x.action==='heartbeat'){
    if(!['ready','busy','offline'].includes(x.state))throw new ArchiveError('Invalid state');
    if(imageMode()==='local')await queue().health(x.state);
    else await db('realistic_health','on_conflict=id','POST',{id:true,state:x.state,seen_at:new Date().toISOString()},'resolution=merge-duplicates,return=minimal');
    return {ok:true};
  }
  if(x.action==='claim'){
    const token=randomUUID();const j=imageMode()==='local'?await queue().claim(token):(await db<ImageJob[]>('rpc/realistic_claim','','POST',{p_token:token}))[0];
    return {job:j?{id:j.id,token:j.token,settings:j.settings}:null};
  }
  if(!uuid(x.id)||!uuid(x.token))throw new ArchiveError('Invalid claim');
  if(x.action==='source'){
    const job=await getImageJob(x.id);
    if(job.token!==x.token||!['claimed','generating'].includes(job.phase)||Date.parse(job.lease_until??'')<Date.now())throw new ArchiveError('Invalid claim',409);
    const cid=job.settings.archiveConversationId;
    if(!cid||!job.settings.sourceAssetId)throw new ArchiveError('Source unavailable',404);
    await conversation(cid,job.owner);
    const asset=(await assetsFor(cid)).find(a=>a.id===job.settings.sourceAssetId);
    if(!asset||asset.size>2000000||!['image/png','image/jpeg','image/webp'].includes(asset.mime))throw new ArchiveError('Invalid source');
    const bytes=await getAssetBytes(asset);if(bytes.length>2000000)throw new ArchiveError('Invalid source');
    return {image:bytes.toString('base64')};
  }
  if(x.action==='complete'){
    const job=await getImageJob(x.id);
    if(job.token!==x.token)throw new ArchiveError('Invalid claim',409);
    if(job.phase==='done'){if(imageMode()==='cloud')await syncImageArchive(job);return {ok:true};}
    await update(x.id,x.token,'renew');
    if(typeof x.png!=='string'||x.png.length>2800000||!/^[a-f0-9]{32}$/.test(x.imageId))throw new ArchiveError('Invalid image');
    const bytes=Buffer.from(x.png,'base64');
    if(!validMedia(bytes,'image/png')||bytes.length>2000000)throw new ArchiveError('Invalid image');
    if(imageMode()==='local'){
      await mkdir(join(root(),'images'),{recursive:true});
      const temp=join(root(),'images',x.id+'.tmp');await writeFile(temp,bytes,{mode:0o600});await rename(temp,join(root(),'images',x.id+'.png'));
    }else await supabase(`/storage/v1/object/${BUCKET}/${job.owner}/${job.id}.png`,{method:'POST',headers:{'Content-Type':'image/png','x-upsert':'true'},body:bytes});
    await update(x.id,x.token,'complete',{image_id:x.imageId});
    if(imageMode()==='cloud')await syncImageArchive(await getImageJob(x.id),undefined,bytes);
    return {ok:true};
  }
  await update(x.id,x.token,x.action,x.action==='fail'?{error:'היצירה לא הושלמה. הבקשה לא נשלחה מחדש אוטומטית.'}:{});
  return {ok:true};
}
export async function imageFile(job:ImageJob,download:boolean){
  if(job.phase!=='done')throw new ArchiveError('התמונה עדיין אינה מוכנה.',409);
  const headers={'Cache-Control':'private, no-store','Content-Type':'image/png','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Disposition':`${download?'attachment':'inline'}; filename="image-${job.id}.png"`};
  if(imageMode()==='local')return new Response(await readFile(join(root(),'images',job.id+'.png')),{headers});
  const path=`/${BUCKET}/${job.owner}/${job.id}.png`;
  const signed=await(await supabase('/storage/v1/object/sign'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expiresIn:60})})).json();
  if(typeof signed.signedURL!=='string'||!signed.signedURL.startsWith('/object/sign/'))throw new ArchiveError('התמונה לא זמינה.',503);
  const url=process.env.SUPABASE_URL!.replace(/\/$/,'')+'/storage/v1'+signed.signedURL+(download?'&download=image.png':'');
  return new Response(null,{status:302,headers:{Location:url,'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}});
}
