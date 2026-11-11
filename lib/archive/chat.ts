import 'server-only';
import {createHash} from 'node:crypto';
import {conversation,db,patchTurn,assetsFor} from './store';
import {ArchiveError,uuid} from './validation';
import type {ArchiveTurn} from './types';

export type ChatArchiveInput={id:string;conversationId:string;text:string;assets:string[]};
export function parseChatArchive(x:unknown):ChatArchiveInput{
  const b=x as ChatArchiveInput;
  if(!b||!uuid(b.id)||!uuid(b.conversationId)||typeof b.text!=='string'||b.text.length>16000||!Array.isArray(b.assets)||b.assets.length>4||!b.assets.every(uuid))throw new ArchiveError('פרטי השמירה אינם תקינים.');
  return {id:b.id,conversationId:b.conversationId,text:b.text,assets:b.assets};
}
export async function beginChat(owner:string,input:ChatArchiveInput,model:string){
  await conversation(input.conversationId,owner);
  const hash=createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const created=await db<boolean>('rpc/archive_begin_turn','','POST',{p_owner:owner,p_conversation:input.conversationId,p_id:input.id,p_hash:hash,p_model:'chat:'+model,p_input:input.text,p_assets:input.assets});
  if(!created)throw new ArchiveError('הבקשה כבר התקבלה. לא נשלח אותה שוב.',409);
}
export async function finishChat(id:string,text:string,error?:string){
  await patchTurn(id,{status:error?'failed':'completed',output:text?[{type:'text',text}]:[],error:error??null,checked_at:new Date().toISOString()});
}
export async function preserveLocalTurn(owner:string,body:Record<string,unknown>){
  const input=parseChatArchive(body);
  if(typeof body.answer!=='string'||body.answer.length>100000||(body.error!==undefined&&typeof body.error!=='string'))throw new ArchiveError('תשובה לא תקינה.');
  await conversation(input.conversationId,owner);
  const [existing]=await db<ArchiveTurn[]>('archive_turns',`id=eq.${input.id}&limit=1`);
  if(existing){if(existing.conversation_id!==input.conversationId)throw new ArchiveError('הבקשה אינה שייכת לשיחה.',409);return;}
  const assets=await assetsFor(input.conversationId);
  if(input.assets.some(id=>!assets.some(a=>a.id===id)))throw new ArchiveError('קובץ חסר.');
  if(body.outputAsset&&(!uuid(body.outputAsset)||!assets.some(a=>a.id===body.outputAsset&&a.mime.startsWith(body.kind==='video'?'video/':'image/'))))throw new ArchiveError('תוצאה לא תקינה.');
  // Insert a final historical turn directly; it never enters the generation queue.
  await db('archive_turns','on_conflict=id','POST',{id:input.id,conversation_id:input.conversationId,input_hash:createHash('sha256').update(JSON.stringify(input)).digest('hex'),model_key:'chat:imported',input:input.text,assets:input.assets,status:body.error?'failed':'completed',error:body.error??null,output:[...(body.answer?[{type:'text',text:body.answer}]:[]),...(body.outputAsset?[{type:body.kind==='video'?'video':'image',assetId:body.outputAsset}]:[])]},'resolution=ignore-duplicates,return=minimal');
}
