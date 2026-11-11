import type {Conversation, Msg} from './history';
import type {ArchiveAsset, ArchiveTranscript} from './archive/types';
import {requestJson as api} from './gemini-progress';
import {archiveId, conversationArchiveId, isAnswerArchived} from './unified-chat';
export const post=(body:unknown):RequestInit=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
export async function ensureChatArchive(c:Conversation){
  if(c.localOnly)throw Error('השיחה כוללת תמונות מקומיות ונשמרת במכשיר בלבד.');
  const id=await conversationArchiveId(c);
  await api('/api/gemini/conversations',post({id,title:c.title}));
  return id;
}
export async function archiveFile(cid:string,file:File):Promise<string>{
  const form=new FormData();form.set('conversationId',cid);form.set('file',file);
  return (await api<ArchiveAsset>('/api/gemini/assets',{method:'POST',body:form})).id;
}
export async function archiveImage(cid:string,url:string):Promise<string>{
  const match=/^\/api\/gemini\/assets\/([a-f0-9-]+)$/i.exec(url);
  if(match){
    const transcript=await api<ArchiveTranscript>(`/api/gemini/conversations/${cid}`);
    if(transcript.assets.some(a=>a.id===match[1]))return match[1];
  }
  const generated=/^\/api\/images\/jobs\/[a-f0-9-]{36}\/file$/i.test(url);
  if(!url.startsWith('data:image/')&&!url.startsWith('/media/')&&!match&&!generated)throw Error('קובץ לא תקין.');
  const r=await fetch(url);if(!r.ok)throw Error('לא הצלחנו לשמור את הקובץ בארכיון. השיחה נשארה במכשיר.');
  const blob=await r.blob();
  return archiveFile(cid,new File([blob],blob.type.startsWith('video/')?'video.mp4':'image.jpg',{type:blob.type}));
}
export async function archiveInputs(cid:string,m:Msg){
  const assets:string[]=[];
  for(const src of m.full??m.images??[])assets.push(await archiveImage(cid,src));
  if(m.doc)assets.push(await archiveFile(cid,new File([m.doc.text],m.doc.name+'.txt',{type:'text/plain'})));
  return assets;
}
// Copy only missing local turns; existing archived messages and generations are immutable here.
// Used before continuing or removing an old local conversation, never on every render.
export async function preserveChat(c:Conversation){
  const cid=await ensureChatArchive(c);
  const saved=await api<ArchiveTranscript>(`/api/gemini/conversations/${cid}`);
  for(let i=0;i<c.messages.length;i++){
    const user=c.messages[i];if(user.role!=='user')continue;
    const answer=c.messages[i+1]?.role==='assistant'?c.messages[i+1]:undefined;
    if(answer?.media?.provider==='realistic'){
      if(answer.media.jobId&&!answer.media.submission)await api(`/api/images/jobs/${answer.media.jobId}/archive`,post({conversationId:cid}));
      continue;
    }
    if(user.privateImage)continue;
    const tid=user.archiveTurnId??answer?.media?.jobId??await archiveId(c.id+':'+i);
    // Legacy OpenArt job ids are not archive UUIDs.
    const id=/^[a-f0-9-]{36}$/i.test(tid)?tid:await archiveId(c.id+':'+i);
    const existing=saved.turns.find(t=>t.id===id);
    if(existing){
      // A saved request is not proof that its streamed answer was saved too.
      // Keep the local copy when the server has only a partial answer.
      if(!isAnswerArchived(existing,answer))throw Error('התשובה עדיין לא נשמרה במלואה בארכיון. השיחה נשארה במכשיר. נסו שוב בעוד רגע.');
      continue;
    }
    const assets=await archiveInputs(cid,user);
    let outputAsset:string|undefined;
    if(answer?.media?.status==='done'&&answer.media.url)outputAsset=await archiveImage(cid,answer.media.url);
    await api('/api/chat/archive',post({id,conversationId:cid,text:user.content,assets,answer:answer?.content??'',error:answer?.error??answer?.media?.error,outputAsset,kind:answer?.media?.kind}));
  }
  return cid;
}
