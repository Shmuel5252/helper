'use client';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowUp, Camera, ImagePlus, Menu, Paperclip, Plus, X } from 'lucide-react';
import ArchiveMessages from './ArchiveMessages';
import ChatWelcome from './ChatWelcome';
import ChatModeSwitch from './ChatModeSwitch';
import GeminiHistory from './GeminiHistory';
import GeminiRetry from './GeminiRetry';
import {buildRetry,type RetryAttempt} from '@/lib/gemini-retry';
import {requestJson as api, RequestError} from '@/lib/gemini-progress';
import {watchUpdates} from '@/lib/gemini-polling';
import {prepareAttachment} from '@/lib/gemini-upload';
import { ARCHIVE_MODELS, uuid } from '@/lib/archive/validation';
import type { ArchiveAsset, ArchiveModel, ArchiveTranscript, ArchiveTurn, TurnInput } from '@/lib/archive/types';

type IndexEntry={id:string;title:string};
const KEY='ai-chat:gemini:index:v1';
const EVENT='gemini-history';
function subscribe(fn:()=>void){window.addEventListener('storage',fn);window.addEventListener(EVENT,fn);return()=>{window.removeEventListener('storage',fn);window.removeEventListener(EVENT,fn);};}
function snapshot(){try{return localStorage.getItem(KEY)??'[]';}catch{return '[]';}}
function readIndex(raw:string):IndexEntry[]{try{const a=JSON.parse(raw);return Array.isArray(a)?a.filter(e=>uuid(e?.id)&&typeof e.title==='string'):[];}catch{return [];}}
function remember(entry:IndexEntry){const list=readIndex(snapshot());try{localStorage.setItem(KEY,JSON.stringify([entry,...list.filter(e=>e.id!==entry.id)].slice(0,200)));}catch{throw new Error('לא הצלחנו לפתוח שיחה בדפדפן הזה. נסו לפנות מקום או להשתמש בדפדפן אחר.');}window.dispatchEvent(new Event(EVENT));}
function forget(id:string){try{localStorage.setItem(KEY,JSON.stringify(readIndex(snapshot()).filter(e=>e.id!==id)));window.dispatchEvent(new Event(EVENT));}catch{/* The selected missing conversation is still cleared in memory. */}}
const post=(body:unknown):RequestInit=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});

export default function GeminiChat(){
  const raw=useSyncExternalStore(subscribe,snapshot,()=> '[]');
  const list=useMemo(()=>readIndex(raw),[raw]);
  const [selected,setSelected]=useState<string|null|undefined>(undefined);
  const id=selected===undefined?(list[0]?.id??null):selected;
  const [data,setData]=useState<ArchiveTranscript|null>(null);
  const [text,setText]=useState(''); const [modelKey,setModelKey]=useState('account-image');
  const [models,setModels]=useState<ArchiveModel[]>([]);
  const [attachments,setAttachments]=useState<ArchiveAsset[]>([]);
  const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  const [uploadStatus,setUploadStatus]=useState('');
  const [ready,setReady]=useState<boolean|null>(null); const [menu,setMenu]=useState(false);
  const [optimistic,setOptimistic]=useState<ArchiveTurn|null>(null);
  const [updates,setUpdates]=useState({id:'',connected:false,updatedAt:0});
  const [now,setNow]=useState(0);
  const [retryTurn,setRetryTurn]=useState<ArchiveTurn|null>(null);
  const [retryError,setRetryError]=useState('');
  const retryAttempt=useRef<RetryAttempt|null>(null);
  const current=useRef<string|null>(null); const requestRef=useRef<TurnInput|null>(null);
  const inFlight=useRef(false); const bottom=useRef<HTMLDivElement>(null);
  const activeData=data?.conversation.id===id?data:null;
  const pending=(activeData?.turns.some(t=>t.status==='starting'||t.status==='running')??false)||!!(optimistic?.conversation_id===id&&['starting','running'].includes(optimistic.status));
  const visibleTurns=[...(activeData?.turns??[])];
  if(optimistic?.conversation_id===id&&!visibleTurns.some(t=>t.id===optimistic.id))visibleTurns.push(optimistic);
  const visibleAssets=[...(activeData?.assets??[]),...attachments.filter(a=>!activeData?.assets.some(saved=>saved.id===a.id))];
  const lastTurn=visibleTurns.at(-1);

  useEffect(()=>{let live=true;async function config(){try{const c=await api<{available:boolean;models:ArchiveModel[]}>('/api/gemini/config');if(live){setReady(c.available);setModels(c.models);}}catch{if(live)setReady(null);}}const stop=watchUpdates(config,window,document,30000);return()=>{live=false;stop();};},[]);
  useEffect(()=>{if(!pending)return;const tick=()=>setNow(Date.now());const timer=setInterval(tick,2000);window.addEventListener('focus',tick);document.addEventListener('visibilitychange',tick);return()=>{clearInterval(timer);window.removeEventListener('focus',tick);document.removeEventListener('visibilitychange',tick);};},[pending]);
  useEffect(()=>{
    current.current=id; if(!id)return;
    let cancelled=false;
    async function load(){
      try {
        let next=await api<ArchiveTranscript>(`/api/gemini/conversations/${id}`);
        if(cancelled)return;
        if(!cancelled){setData(next);setUpdates({id:id!,connected:true,updatedAt:Date.now()});}
        const jobs=next.turns.filter(t=>t.status==='running'||t.status==='starting');
        if(jobs.length){await Promise.all(jobs.map(t=>api(`/api/gemini/turns/${t.id}`,{method:'POST'})));next=await api<ArchiveTranscript>(`/api/gemini/conversations/${id}`);}
        if(!cancelled){setData(next);setOptimistic(old=>old&&next.turns.some(t=>t.id===old.id)?null:old);setUpdates({id:id!,connected:true,updatedAt:Date.now()});}
      }catch(e){if(!cancelled){if(e instanceof RequestError&&e.status===404){
        // A new conversation is remembered before its POST completes. Polling
        // must not mistake that short creation window for a deleted chat.
        if(!inFlight.current){forget(id!);setSelected(null);setData(null);setAttachments([]);setText('');requestRef.current=null;setError('');return;}
      }else setUpdates(old=>({id:id!,connected:false,updatedAt:old.id===id?old.updatedAt:0}));}}
    }
    const stop=watchUpdates(load,window,document);return()=>{cancelled=true;stop();};
  },[id]);
  useEffect(()=>{bottom.current?.scrollIntoView({behavior:'smooth',block:'end'});},[lastTurn?.id,lastTurn?.status,busy]);

  const ensureConversation=useCallback(async(conversationId=id??crypto.randomUUID())=>{
    const title=text.trim().replace(/\s+/g,' ').slice(0,60)||'שיחה חדשה';
    if(!id){
      // Record locally before sending so a reload never loses the accepted conversation ID.
      remember({id:conversationId,title});setSelected(conversationId);current.current=conversationId;
    }
    await api('/api/gemini/conversations',post({id:conversationId,title}));
    return conversationId;
  },[id,text]);

  async function upload(files:File[]){
    if(!files.length || inFlight.current || pending)return;
    inFlight.current=true;setBusy(true);setError('');
    try{
      if(attachments.length+files.length>4)throw new Error('אפשר לצרף עד ארבעה קבצים.');
      setUploadStatus('מכין את התמונות והקבצים…');
      const prepared:File[]=[];
      for(const file of files)prepared.push(await prepareAttachment(file));
      setUploadStatus('מעלה קבצים…');
      const cid=await ensureConversation();
      for(const file of prepared){const form=new FormData();form.set('conversationId',cid);form.set('file',file);
        const a=await api<ArchiveAsset>('/api/gemini/assets',{method:'POST',body:form});setAttachments(old=>[...old,a]);}
    }catch(e){setError(e instanceof Error?e.message:'לא הצלחנו לצרף את הקובץ.');}
    finally{inFlight.current=false;setBusy(false);setUploadStatus('');}
  }
  async function send(){
    if(inFlight.current||pending||(!text.trim()&&!attachments.length))return;
    if(!models.some(m=>m.key===modelKey)){setError('האפשרות הזו אינה זמינה כרגע. נסו שוב בעוד רגע.');return;}
    inFlight.current=true;setBusy(true);setError('');
    try{
      const cid=id??crypto.randomUUID();
      const candidate={conversationId:cid,modelKey,text:text.trim(),assets:attachments.map(a=>a.id)};
      const previous=requestRef.current;
      const same=previous && previous.conversationId===candidate.conversationId && previous.modelKey===candidate.modelKey && previous.text===candidate.text && JSON.stringify(previous.assets)===JSON.stringify(candidate.assets);
      const input:TurnInput={...candidate,id:same?previous.id:crypto.randomUUID()}; requestRef.current=input;
      setOptimistic({id:input.id,conversation_id:cid,sequence:0,model_key:modelKey,input:input.text,assets:input.assets,status:'starting',provider_id:null,input_hash:'',output:[],error:null,created_at:new Date().toISOString(),checked_at:new Date().toISOString()});
      await ensureConversation(cid);
      await api('/api/gemini/turns',post(input));
      const next=await api<ArchiveTranscript>(`/api/gemini/conversations/${cid}`);
      if(current.current===cid){setData(next);setText('');setAttachments([]);requestRef.current=null;}
    }catch(e){setError(e instanceof Error?e.message:'לא הצלחנו לשלוח, נסו שוב.');}
    finally{inFlight.current=false;setBusy(false);setOptimistic(null);}
  }
  async function resend(){
    if(!retryTurn||!activeData||retryTurn.conversation_id!==id||inFlight.current||pending||!ready)return;
    if(!models.some(m=>m.key===retryTurn.model_key)){setRetryError('האפשרות הזו אינה זמינה כרגע.');return;}
    inFlight.current=true;setBusy(true);setRetryError('');setError('');
    try{
      const attempt=buildRetry(retryTurn,activeData.assets,retryAttempt.current);
      retryAttempt.current=attempt;
      const input=attempt.input;
      const accepted=await api<{id:string;status:ArchiveTurn['status'];error:string|null}>('/api/gemini/turns',post(input));
      // Keep the acknowledged request visible even if the following read fails.
      const copy:ArchiveTurn={...retryTurn,id:accepted.id,status:accepted.status,error:accepted.error,sequence:0,output:[],provider_id:null,input_hash:'',created_at:new Date().toISOString(),checked_at:new Date().toISOString()};
      setOptimistic(copy);
      setData(old=>old?.conversation.id===input.conversationId?{...old,turns:old.turns.some(t=>t.id===copy.id)?old.turns:[...old.turns,copy]}:old);
      retryAttempt.current=null;setRetryTurn(null);
      setUpdates({id:input.conversationId,connected:false,updatedAt:0});
    }catch(e){setRetryError(e instanceof Error?e.message:'לא התקבל אישור לשליחה.');}
    finally{inFlight.current=false;setBusy(false);}
  }
  function choose(cid:string|null){if(busy)return;setSelected(cid);setAttachments([]);setText('');setError('');setMenu(false);requestRef.current=null;}
  async function removeChat(cid:string,scope:'device'|'all'){
    if(inFlight.current)throw new Error('המתינו לסיום הפעולה הנוכחית.');
    inFlight.current=true;setBusy(true);
    try{
      if(scope==='all'){
        try{await api(`/api/gemini/conversations/${cid}`,{method:'DELETE'});}
        catch(e){if(!(e instanceof RequestError&&e.status===404))throw e;}
      }
      // Local removal never calls the server or deletes the saved copy.
      localStorage.setItem(KEY,JSON.stringify(readIndex(snapshot()).filter(e=>e.id!==cid)));
      window.dispatchEvent(new Event(EVENT));
      if(id===cid){setSelected(null);current.current=null;setData(null);setAttachments([]);setText('');setOptimistic(null);setError('');requestRef.current=null;}
    }finally{inFlight.current=false;setBusy(false);}
  }
  return <div className="flex min-h-dvh flex-col bg-bg">
    <header className="app-header sticky top-0 z-20 pt-[env(safe-area-inset-top)]"><div className="mx-auto flex min-h-16 max-w-3xl items-center gap-2 px-3">
      <button aria-label="היסטוריית שיחות" aria-haspopup="dialog" aria-expanded={menu} onClick={()=>setMenu(true)} className="ui-icon"><Menu size={21}/></button>
      <h1 className="sr-only">Gemini</h1>
      <ChatModeSwitch active="gemini"/>
      <button onClick={()=>choose(null)} disabled={busy} className="ui-icon ms-auto" aria-label="שיחה חדשה"><Plus size={22}/></button>
    </div></header>
    <GeminiHistory open={menu} onClose={()=>setMenu(false)} onSelect={choose} onDelete={removeChat} entries={list} selected={id} disabled={busy}/>
    <GeminiRetry turn={retryTurn} busy={busy} error={retryError} disabled={!ready||pending} onCancel={()=>{setRetryTurn(null);setRetryError('');}} onConfirm={()=>void resend()}/>
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 sm:px-6">
      {!visibleTurns.length&&!busy&&<ChatWelcome title="מה ניצור היום?"/>}
      {!!visibleTurns.length&&<ArchiveMessages turns={visibleTurns} assets={visibleAssets} retryDisabled={busy||pending||!ready} onRetry={turn=>{if(!busy&&!pending){setRetryTurn(turn);setRetryError('');}}} updates={{connected:updates.id===id&&updates.connected,updatedAt:updates.id===id?updates.updatedAt:0,now}} onReuse={(asset,kind)=>{if(!busy&&!pending){setAttachments([asset]);setModelKey(`account-${kind}`);}}}/>}
      {uploadStatus&&<p role="status" className="py-3 text-muted">{uploadStatus}</p>}
      <div ref={bottom}/>
    </main>
    <footer className="composer-footer sticky bottom-0 bg-bg px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-3xl">
        {ready===false&&!pending&&<p className="mb-3 text-danger">החיבור ל־Gemini אינו זמין כרגע. נבדוק שוב אוטומטית.</p>}
        {((ready===null)||(id&&updates.id===id&&!updates.connected))&&!pending&&<p role="status" className="mb-3 text-sm text-muted">ממתין לעדכון החיבור…</p>}
        {error&&<p role="alert" className="mb-3 text-danger">{error}</p>}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1"><label htmlFor="gemini-model" className="sr-only">מודל</label>
          <select id="gemini-model" value={modelKey} disabled={busy||pending} onChange={e=>{setModelKey(e.target.value);}} className="min-w-0 max-w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm">{ARCHIVE_MODELS.map(m=><option key={m.key} value={m.key} disabled={!models.some(available=>available.key===m.key)}>{m.label}</option>)}</select>
        </div>
        {attachments.length>0&&<div className="mb-2 flex flex-wrap gap-2">{attachments.map(a=><span key={a.id} className="flex max-w-full items-center gap-2 rounded-xl bg-bubble px-3 py-2 text-sm"><span className="truncate">{a.name}</span><button disabled={busy} aria-label={`הסרת ${a.name}`} onClick={()=>{setAttachments(old=>old.filter(x=>x.id!==a.id));}}><X size={16}/></button></span>)}</div>}
        <form onSubmit={e=>{e.preventDefault();void send();}} className="chat-composer rounded-[1.75rem] border border-line bg-surface p-2">
          <textarea aria-label="הודעה ל־Gemini" placeholder="כתבו הודעה…" value={text} maxLength={4000} disabled={busy||pending} onChange={e=>{setText(e.target.value);}} rows={2} className="block max-h-48 w-full resize-none bg-transparent px-3 py-2 outline-none"/>
          <div className="flex items-center justify-between gap-1"><div className="flex min-w-0 items-center gap-1">
            <label className={`relative flex min-h-11 cursor-pointer items-center gap-2 rounded-full px-2 py-2 text-sm text-muted focus-within:ring-2 focus-within:ring-accent ${busy||pending||!ready?'pointer-events-none opacity-40':''}`}><ImagePlus size={18}/>תמונות<input type="file" multiple accept="image/*" className="absolute inset-0 w-full cursor-pointer opacity-0" aria-label="בחירת תמונות מהגלריה" disabled={busy||pending||!ready} onChange={e=>{const files=Array.from(e.target.files??[]);e.target.value='';void upload(files);}}/></label>
            <label className={`relative flex min-h-11 cursor-pointer items-center gap-2 rounded-full px-2 py-2 text-sm text-muted focus-within:ring-2 focus-within:ring-accent ${busy||pending||!ready?'pointer-events-none opacity-40':''}`}><Camera size={18}/>צילום<input type="file" accept="image/*" capture="environment" className="absolute inset-0 w-full cursor-pointer opacity-0" aria-label="צילום תמונה" disabled={busy||pending||!ready} onChange={e=>{const files=Array.from(e.target.files??[]);e.target.value='';void upload(files);}}/></label>
            <label className={`relative flex min-h-11 cursor-pointer items-center gap-2 rounded-full px-2 py-2 text-sm text-muted focus-within:ring-2 focus-within:ring-accent ${busy||pending||!ready?'pointer-events-none opacity-40':''}`}><Paperclip size={18}/>קובץ<input type="file" multiple accept=".pdf,.docx,.txt,.md,.csv" className="absolute inset-0 w-full cursor-pointer opacity-0" aria-label="צירוף קבצים" disabled={busy||pending||!ready} onChange={e=>{const files=Array.from(e.target.files??[]);e.target.value='';void upload(files);}}/></label>
          </div>
            <button type="submit" aria-label="שליחה" disabled={busy||pending||!ready||!models.some(m=>m.key===modelKey)||(!text.trim()&&!attachments.length)} className="flex size-11 items-center justify-center rounded-full bg-accent text-accent-fg disabled:opacity-35"><ArrowUp size={22}/></button></div>
        </form>
      </div>
    </footer>
  </div>;
}
