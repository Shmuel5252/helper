import Markdown from './Markdown';
import ArchiveFile from './ArchiveFile';
import GenerationProgress from './GenerationProgress';
import { modelFor } from '@/lib/archive/validation';
import type { ArchiveAsset, ArchiveTurn } from '@/lib/archive/types';
import {progressState,updatesStale} from '@/lib/gemini-progress';
import {canRetry} from '@/lib/gemini-retry';

export default function ArchiveMessages({turns,assets,onReuse,updates,onRetry,retryDisabled=false}:{turns:ArchiveTurn[];assets:ArchiveAsset[];onReuse?:(asset:ArchiveAsset,kind:'image'|'video')=>void;updates?:{connected:boolean;updatedAt:number;now:number};onRetry?:(turn:ArchiveTurn)=>void;retryDisabled?:boolean}) {
  const file=(id:string)=>assets.find(a=>a.id===id);
  function renderFile(asset:ArchiveAsset) {
    return <div key={asset.id} className="my-3 min-w-0">
      <ArchiveFile asset={asset}/>
      <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted">
        {onReuse && asset.mime.startsWith('image/') && <><button onClick={()=>onReuse(asset,'image')} className="rounded-xl border border-line px-3 py-2">עריכת התמונה</button><button onClick={()=>onReuse(asset,'video')} className="rounded-xl border border-line px-3 py-2">הפיכה לסרטון</button></>}
      </div>
    </div>;
  }
  return <div className="space-y-8 py-6">{turns.map(t=><section key={t.id} className="space-y-5">
    <div className="ms-auto max-w-[90%] rounded-3xl bg-bubble px-5 py-3">
      <p className="whitespace-pre-wrap break-words" dir="auto">{t.input}</p>
      {t.assets.map(id=>{const a=file(id);return a?renderFile(a):null;})}
    </div>
    <div className="min-w-0 px-1">
      <p className="mb-2 text-xs text-muted">{t.model_key==='realistic-image'?'Realistic Vision V5.1':modelFor(t.model_key)?.label ?? (t.model_key.startsWith('chat:')?'צ׳אט':'Gemini')}</p>
      {t.output.map((o,i)=>o.type==='text'?<Markdown key={i} text={o.text}/>:file(o.assetId)?renderFile(file(o.assetId)!):null)}
      {!(t.status==='failed'&&t.output.some(o=>o.type==='text'))&&(updates ? (()=>{const state=progressState(t.status,updates.connected,updates.updatedAt,updates.now);return state?<GenerationProgress kind={modelFor(t.model_key)?.kind??'chat'} state={state} stale={updatesStale(updates.connected,updates.updatedAt,updates.now)}/>:null;})() : (t.status==='starting'||t.status==='running')&&<GenerationProgress kind={modelFor(t.model_key)?.kind??'chat'}/>)}
      {t.error&&!(updates&&t.status==='uncertain'&&t.error==='Gemini לא השלים את היצירה. אפשר לנסות שוב מאוחר יותר.')&&<p role="alert" className="mt-3 text-danger">{t.error}</p>}
      {onRetry&&canRetry(t)&&<button disabled={retryDisabled} onClick={()=>onRetry(t)} className="ui-button mt-4 disabled:opacity-40">שליחה מחדש</button>}
    </div>
  </section>)}</div>;
}
