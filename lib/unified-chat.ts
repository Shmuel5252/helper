import type { Conversation, MediaResult, Msg } from './history.ts';
import type { ArchiveTranscript, ArchiveTurn } from './archive/types.ts';

export async function archiveId(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('ai-chat:'+value)));
  bytes[6]=(bytes[6]&15)|80; bytes[8]=(bytes[8]&63)|128;
  const h=Array.from(bytes.slice(0,16),b=>b.toString(16).padStart(2,'0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
export const conversationArchiveId=(c:Conversation)=>c.archiveId??archiveId(c.id);
export function isAnswerArchived(turn:ArchiveTurn,answer?:Msg):boolean {
  if(!turn.model_key.startsWith('chat:')||!answer?.content)return true;
  return turn.output.filter(p=>p.type==='text').map(p=>p.text).join('').includes(answer.content);
}
export function mediaPatch(t: ArchiveTurn): Partial<MediaResult> {
  const file=t.output.find(o=>o.type==='image'||o.type==='video');
  if(t.status==='completed'&&file&&'assetId' in file)return {status:'done',url:`/api/gemini/assets/${file.assetId}`,error:undefined};
  if(t.status==='failed'||t.status==='uncertain'||t.status==='completed')return {status:'failed',error:t.output.filter(o=>o.type==='text').map(o=>'text' in o?o.text:'').join('\n')||t.error||'היצירה לא הושלמה. אפשר לשלוח שוב.'};
  return {status:'pending'};
}
export function transcriptConversation(data:ArchiveTranscript):Conversation {
  const messages:Msg[]=[];
  for(const t of data.turns){
    const images=data.assets.filter(a=>t.assets.includes(a.id)&&a.mime.startsWith('image/')).map(a=>`/api/gemini/assets/${a.id}`);
    messages.push({role:'user',content:t.input,archiveTurnId:t.id,...(images.length?{images}:{})});
    if(t.model_key==='realistic-image'){
      const result=t.output.find(o=>o.type==='image');
      messages.push({role:'assistant',content:'',privateImage:true,media:{kind:'image',status:'pending',provider:'realistic',conversationId:t.conversation_id,jobId:t.id,prompt:t.input,originalRequest:t.input,settings:result&&'realistic'in result?result.realistic?.settings:undefined,optionKey:'generate_image',label:'Realistic Vision',modelName:'Realistic Vision V5.1',credits:0,...mediaPatch(t)}});
    }
    else if(['account-image','account-video','fal-image-v1','fal-video-v1'].includes(t.model_key))messages.push({role:'assistant',content:'',media:{kind:t.model_key.includes('video')?'video':'image',status:'pending',provider:t.model_key.startsWith('fal-')?'fal':'account',conversationId:t.conversation_id,jobId:t.id,prompt:t.input,optionKey:t.model_key,label:'',modelName:'',credits:0,...mediaPatch(t)}});
    else messages.push({role:'assistant',content:t.output.filter(o=>o.type==='text').map(o=>'text'in o?o.text:'').join('\n'),...(t.error?{error:t.error}:{})});
  }
  return {id:data.conversation.id,archiveId:data.conversation.id,title:data.conversation.title,createdAt:Date.parse(data.conversation.created_at),updatedAt:Date.parse(data.conversation.updated_at),pinned:false,messages};
}
export const removeLocalChat=(conversations:Conversation[],id:string)=>conversations.filter(c=>c.id!==id);
