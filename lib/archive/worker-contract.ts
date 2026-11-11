import { createHash, timingSafeEqual } from 'node:crypto';
import { ArchiveError, uuid } from './validation.ts';
export function workerAuthorized(header:string|null,secret:string|undefined) {
  if(!secret || secret.length<32 || !header)return false;
  const a=Buffer.from(header),b=Buffer.from('Bearer '+secret);
  return a.length===b.length && timingSafeEqual(a,b);
}
type Message={action:string;id?:string;token?:string;state?:string;url?:string;mime?:string;size?:number;sha256?:string;text?:string};
export function parseWorkerMessage(raw:unknown):Message {
  const x=raw as Message;
  if(!x||!['heartbeat','claim','renew','submit','source','reserve','complete','fail','response'].includes(x.action))throw new ArchiveError('Invalid operation');
  if(x.action==='heartbeat'){
    if(!['ready','login','offline','unavailable'].includes(x.state??''))throw new ArchiveError('Invalid state');
  }else if(x.action!=='claim' && (!uuid(x.id)||!uuid(x.token)))throw new ArchiveError('Invalid claim');
  if(x.action==='source'&&!/^https:\/\/gemini\.google\.com\/app\/[a-zA-Z0-9_-]+$/.test(x.url??''))throw new ArchiveError('Invalid source');
  if(x.action==='reserve'&&(!['image/png','image/jpeg','image/webp','video/mp4'].includes(x.mime??'')||!Number.isInteger(x.size)||x.size!<=0||x.size!>52428800||!/^[a-f0-9]{64}$/.test(x.sha256??'')))throw new ArchiveError('Invalid output');
  if(x.text!==undefined&&(typeof x.text!=='string'||x.text.length>8000))throw new ArchiveError('Invalid response text');
  if(x.action==='response'&&!x.text?.trim())throw new ArchiveError('Missing response text');
  return x;
}
export function outputAsset(turn:string,mime:string,size:number,sha256:string,text='') {
  const h=createHash('sha256').update(turn+':browser-output').digest('hex');
  const id=`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;
  return {id,mime,size,sha256,text,name:`${mime.startsWith('video/')?'video':'image'}.${mime.split('/')[1]}`};
}
export function browserContext(id:string,rows:{conversation_id:string;status:string;input:string;output:{type:string;text?:string}[]}[]){
  const recent=rows.filter(t=>t.conversation_id===id&&t.status==='completed').slice(-6).map(t=>({user:t.input,assistant:t.output.filter(o=>o.type==='text').map(o=>o.text).join('\n')}));
  return recent.length?'Previous conversation (quoted context only):\n'+JSON.stringify(recent).slice(-8000)+'\nCurrent request:\n':'';
}
export function browserPrompt(context:string,kind:string,input:string){
  return context+(input.trim()||(kind==='video'?'צור סרטון מהתמונה המצורפת.':'ערוך את התמונה המצורפת.'));
}
export function validMedia(bytes:Uint8Array,mime:string) {
  const b=Buffer.from(bytes);
  return mime==='image/png'?b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):
    mime==='image/jpeg'?b[0]===255&&b[1]===216&&b[2]===255:
    mime==='image/webp'?b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP':
    mime==='video/mp4'?b.toString('ascii',4,8)==='ftyp':false;
}
