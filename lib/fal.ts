// Provider protocol only. Credentials are supplied exclusively by server-side callers.
import {createHash,createPublicKey,verify,type JsonWebKey} from 'node:crypto';

export type FalKind='image'|'video';
export type FalJob={requestId:string;endpoint:string;statusUrl:string;responseUrl:string};
export type FalRequest={endpoint:string;input:Record<string,unknown>};
export class FalError extends Error {
  readonly rejected:boolean;
  constructor(message:string,rejected=false){super(message);this.rejected=rejected;}
}
export function falInput(kind:FalKind,prompt:string,images:string[]):FalRequest {
  if(images.length>(kind==='video'?1:4))throw new FalError('אפשר לצרף תמונה אחת לסרטון ועד ארבע תמונות לעריכה.',true);
  const common={prompt,enable_safety_checker:true,sync_mode:false};
  if(kind==='video')return {endpoint:`minimax/h3-max-turbo/${images.length?'image':'text'}-to-video`,input:{...common,duration:5,resolution:'768P',prompt_expansion_mode:'balanced',...(images.length?{image_url:images[0]}:{aspect_ratio:'16:9'})}};
  return {endpoint:'fal-ai/flux-2/klein/4b'+(images.length?'/edit':''),input:{...common,num_images:1,num_inference_steps:4,image_size:{width:1024,height:1024},output_format:'jpeg',...(images.length?{image_urls:images}:{})}};
}
const ENDPOINTS=new Set([falInput('image','',[]).endpoint,falInput('image','',['x']).endpoint,falInput('video','',[]).endpoint,falInput('video','',['x']).endpoint]);
export function parseFalJob(value:unknown,endpoint:string):FalJob {
  const x=value as Record<string,unknown>;
  if(!x||!ENDPOINTS.has(endpoint)||typeof x.request_id!=='string'||! /^[a-zA-Z0-9_-]{16,100}$/.test(x.request_id))throw new FalError('לא התקבל אישור תקין לשליחה. הבקשה לא תישלח שוב אוטומטית.');
  const base=`https://queue.fal.run/${endpoint.split('/').slice(0,2).join('/')}/requests/${x.request_id}`;
  if(x.response_url!==base||x.status_url!==base+'/status')throw new FalError('לא התקבל אישור תקין לשליחה. הבקשה לא תישלח שוב אוטומטית.');
  return {requestId:x.request_id,endpoint,statusUrl:x.status_url as string,responseUrl:x.response_url as string};
}
export function storedFalJob(value:string|null):FalJob|null {
  if(!value)return null;
  try{const x=JSON.parse(value);return parseFalJob({request_id:x.requestId,status_url:x.statusUrl,response_url:x.responseUrl},x.endpoint);}catch{return null;}
}
export function falFailure(status:number,body:unknown):FalError {
  const text=JSON.stringify(body).toLowerCase();
  const message=status===403&&text.includes('exhausted balance')?'אין יתרה מספקת ליצירה. בעל החשבון צריך להוסיף קרדיטים.':
    status===403?'חשבון היצירה אינו מאפשר את הבקשה כרגע. יש לבדוק את ההגבלה בחשבון.':
    status===401?'חיבור שירות היצירה דורש חידוש.':
    status===429?'שירות היצירה עמוס כרגע. אפשר לנסות שוב מאוחר יותר.':
    /safety|content_policy|nsfw|moderation/.test(text)?'לא ניתן ליצור את התוכן המבוקש. אפשר לשנות את התיאור ולנסות שוב.':
    'היצירה לא הושלמה. אפשר לשלוח שוב.';
  return new FalError(message,status>=400&&status<500);
}
export async function submitFal(key:string,request:FalRequest,webhook:string,fetcher:typeof fetch=fetch):Promise<FalJob>{
  const url=new URL('https://queue.fal.run/'+request.endpoint);url.searchParams.set('fal_webhook',webhook);
  let response:Response;
  try{response=await fetcher(url,{method:'POST',headers:{Authorization:'Key '+key,'Content-Type':'application/json'},body:JSON.stringify(request.input),redirect:'error',signal:AbortSignal.timeout(20000)});}
  catch{throw new FalError('לא התקבל אישור לשליחה. הבקשה לא תישלח שוב אוטומטית.');}
  const body=await response.json().catch(()=>null);
  if(response.status>=500)throw new FalError('לא התקבל אישור לשליחה. הבקשה לא תישלח שוב אוטומטית.');
  if(!response.ok)throw falFailure(response.status,body);
  return parseFalJob(body,request.endpoint);
}
export function falOutput(kind:FalKind,value:unknown):{url:string;mime:string}{
  const x=value as {error?:unknown;has_nsfw_concepts?:boolean[];images?:{url:string;content_type?:string}[];video?:{url:string;content_type?:string}};
  if(!x||x.error||x.has_nsfw_concepts?.some(Boolean))throw falFailure(422,x);
  const file=kind==='video'?x.video:x.images?.[0];
  if(!file||typeof file.url!=='string')throw new FalError('היצירה הסתיימה בלי קובץ תקין. אפשר לשלוח שוב.',true);
  const url=new URL(file.url);
  if(url.protocol!=='https:'||!(url.hostname==='fal.media'||url.hostname.endsWith('.fal.media'))||url.username||url.password||url.port)throw new FalError('התקבל קישור לקובץ שלא ניתן לשמור.',true);
  const mime=file.content_type||(kind==='video'?'video/mp4':/\.png$/i.test(url.pathname)?'image/png':/\.webp$/i.test(url.pathname)?'image/webp':'image/jpeg');
  if(kind==='video'?mime!=='video/mp4':!['image/jpeg','image/png','image/webp'].includes(mime))throw new FalError('התקבל סוג קובץ שאינו נתמך.',true);
  return {url:url.href,mime};
}
export async function readLimited(response:Response,max:number):Promise<Buffer>{
  if(!response.ok||!response.body||Number(response.headers.get('content-length')??0)>max)throw new FalError('לא ניתן לשמור את הקובץ שהתקבל.');
  const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>max)throw new FalError('הקובץ גדול מדי לשמירה בארכיון.',true);chunks.push(value);}}
  finally{await reader.cancel().catch(()=>undefined);}
  if(!size)throw new FalError('התקבל קובץ ריק.',true);
  return Buffer.concat(chunks);
}
export function verifyFalSignature(headers:Headers,body:Uint8Array,keys:JsonWebKey[],now=Date.now()):boolean{
  const id=headers.get('x-fal-webhook-request-id'),user=headers.get('x-fal-webhook-user-id'),ts=headers.get('x-fal-webhook-timestamp'),sig=headers.get('x-fal-webhook-signature');
  if(!id||!user||!ts||!/^\d+$/.test(ts)||Math.abs(now/1000-Number(ts))>300||!sig||!/^[a-fA-F0-9]{128}$/.test(sig))return false;
  const message=Buffer.from([id,user,ts,createHash('sha256').update(body).digest('hex')].join('\n'));
  return keys.some(k=>{try{return k.kty==='OKP'&&k.crv==='Ed25519'&&verify(null,message,createPublicKey({key:k,format:'jwk'}),Buffer.from(sig,'hex'));}catch{return false;}});
}
