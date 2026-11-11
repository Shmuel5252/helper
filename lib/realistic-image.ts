// Shared public contract. No credentials or server imports in this module.
export type ImageSettings={prompt:string;negative_prompt:string;steps:number;guidance_scale:number;seed:number;width:number;height:number;strength?:number;promptMode?:'ai'|'direct'};
export type ImageOverrides=Partial<ImageSettings>;
export type ImageSubmission={id:string;text:string;modelKey?:string;previousJobId?:string;reuseSeed:boolean;settings:ImageOverrides;conversationId?:string;sourceAssetId?:string};
export type ImagePhase='queued'|'claimed'|'generating'|'done'|'failed'|'uncertain';
export type ImageJob={id:string;owner:string;request_hash:string;input:string;settings:ImageSettings & {archiveConversationId?:string;sourceAssetId?:string};phase:ImagePhase;created_at:string;updated_at:string;token?:string|null;lease_until?:string|null;not_before?:string|null;error?:string|null;image_id?:string|null};
export type ImageConfig={enabled:boolean;mode:'local'|'cloud'|'off';promptAI:boolean;worker:'ready'|'busy'|'offline'};
// Preserve the user's exact text independently of the translated generation prompt.
export function imageMetadata(job:ImageJob){
  return {version:1,id:job.id,model:'Realistic Vision V5.1',originalRequest:job.input,settings:job.settings,createdAt:job.created_at};
}
export const DEFAULT_NEGATIVE='low quality, blurry, distorted, watermark, text, malformed hands, extra fingers';
const FACE_QUALITY=['detailed face','sharp eyes','natural skin texture','photorealistic','high quality'];
// Literal keyword detection only: no translation, rewriting or external service.
const PERSON_MENTION=/(?:^|[^\p{L}\p{N}_])(?:person|people|human|humans|man|men|woman|women|boy|boys|girl|girls|child|children|adult|adults|baby|babies|teen|teens|teenager|teenagers|mother|father|daughter|son|[ובכלמהש]{0,3}(?:אדם|אנשים|איש|אישה|אשה|נשים|גבר|גברים|ילד|ילדה|ילדים|ילדות|נער|נערה|נערים|נערות|תינוק|תינוקת|תינוקות|אמא|אימא|אבא))(?=$|[^\p{L}\p{N}_])/iu;
export function usesDirectImagePrompt(settings:ImageOverrides){return settings.promptMode==='direct'||settings.prompt!==undefined;}
export function directImagePrompt(text:string):string{
  if(typeof text!=='string'||!text.trim())throw Error('נדרש תיאור לתמונה.');
  if(!PERSON_MENTION.test(text.normalize('NFD').replace(/[\u0591-\u05c7]/g,'')))return text;
  const missing=FACE_QUALITY.filter(token=>!text.toLowerCase().includes(token));
  return missing.length?text+', '+missing.join(', '):text;
}
export function validImageOrigin(request:Request){
  if(request.headers.get('sec-fetch-site')==='cross-site')return false;
  const origin=request.headers.get('origin');if(!origin)return true;
  try{const url=new URL(request.url),source=new URL(origin);return source.host===(request.headers.get('host')||url.host)&&source.protocol===url.protocol;}catch{return false;}
}
export function sameSeedIntent(text:string){return /(?:אותו\s*(?:seed|סיד)|same\s+seed)/i.test(text);}
export function imageIntent(text:string,hasPrevious=false){
  if(/^(?:אל\s|לא\s|do not\s|don['’]t\s|איך\s|how\s)/i.test(text.trim()))return false;
  return /(?:^(?:בבקשה\s+)?(?:צור|צרי|תיצור|תיצרי|צייר|ציירי|תצייר|תציירי|הכן|הכיני)\b.*(?:תמונה|ציור|צילום)|^(?:בבקשה\s+)?(?:צור|צרי|תיצור|תיצרי|צייר|ציירי|תצייר|תציירי|הכן|הכיני)(?:\s|ו).*?(?:תמונה|ציור|צילום|נוף)|^(?:please\s+)?(?:create|generate|draw|make|paint)\b.*\b(?:image|picture|photo|painting|illustration|drawing)\b)/i.test(text.trim()) || hasPrevious&&/(?:גרסה\s+נוספת|תמונה\s+נוספת|עוד\s+גרסה|another\s+(?:version|image)|same\s+seed|אותו\s*(?:seed|סיד))/i.test(text);
}
export function normalizeSettings(auto:ImageOverrides,manual:ImageOverrides={}):ImageSettings{
  const x={...auto,...manual};
  if(typeof x.prompt!=='string'||!x.prompt.trim())throw Error('נדרש תיאור באנגלית לתמונה.');
  const direct=x.promptMode==='direct';
  if(direct&&x.prompt.length>2000)throw Error('התיאור הישיר, כולל תוספת איכות הפנים, מוגבל ל־2000 תווים.');
  const num=(key:keyof ImageSettings,def:number,min:number,max:number,step=0)=>{
    const raw=x[key]??def;if(typeof raw!=='number'||!Number.isFinite(raw))throw Error('הגדרות התמונה אינן תקינות.');
    const v=Math.min(max,Math.max(min,raw));return step?Math.min(max,Math.max(min,Math.round(v/step)*step)):v;
  };
  let seed=num('seed',-1,-1,2147483647,1);
  if(seed===-1){const n=new Uint32Array(1);crypto.getRandomValues(n);seed=n[0]>>>1;}
  if(x.negative_prompt!==undefined&&typeof x.negative_prompt!=='string')throw Error('Negative prompt אינו תקין.');
  const strength=x.strength===undefined?undefined:num('strength',0.65,0.1,0.9);
  return {prompt:direct?x.prompt:x.prompt.trim().slice(0,2000),negative_prompt:(x.negative_prompt??DEFAULT_NEGATIVE).slice(0,2000),steps:Math.max(num('steps',20,1,30,1),strength?Math.ceil(1/strength):1),guidance_scale:num('guidance_scale',6,1.1,12),width:num('width',512,256,512,64),height:num('height',512,256,512,64),seed,...(strength===undefined?{}:{strength}),...(direct?{promptMode:'direct' as const}:{})};
}
// Quality-oriented automatic choices stay within this model's native API limits.
// Explicit manual choices still take precedence; do not rewrite the user's prompt.
export function automaticImageSettings(auto:ImageOverrides,manual:ImageOverrides={}):ImageSettings{
  const steps=typeof auto.steps==='number'&&Number.isFinite(auto.steps)?Math.max(28,auto.steps):28;
  const guidance=typeof auto.guidance_scale==='number'&&Number.isFinite(auto.guidance_scale)?Math.min(7,Math.max(3.5,auto.guidance_scale)):6;
  return normalizeSettings({...auto,steps,guidance_scale:guidance,width:512,height:512},manual);
}
export function imageStatus(phase:ImagePhase,worker:string){
  if(phase==='queued')return worker==='offline'?'ממתין לשרת התמונות':'ממתין בתור';
  if(phase==='claimed')return 'מכין את התמונה…';
  if(phase==='generating')return worker==='offline'?'החיבור לשרת התמונות נקטע; בודק את הבקשה הקיימת…':'יוצר תמונה… הפעולה עשויה להימשך כדקה או יותר';
  if(phase==='uncertain')return 'החיבור נקטע אחרי תחילת היצירה. הבקשה לא נשלחה שוב כדי למנוע תמונה כפולה.';
  return phase==='failed'?'יצירת התמונה נכשלה.': 'התמונה מוכנה';
}
