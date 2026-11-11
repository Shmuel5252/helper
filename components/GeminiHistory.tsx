'use client';
import { useEffect, useRef, useState } from 'react';
import { MessageCircle, Search, SquarePen, Trash2, X } from 'lucide-react';

export default function GeminiHistory({open,onClose,onSelect,onDelete,entries,selected,disabled}:{open:boolean;onClose:()=>void;onSelect:(id:string|null)=>void;onDelete:(id:string,scope:'device'|'all')=>Promise<void>;entries:{id:string;title:string}[];selected:string|null;disabled:boolean}){
  const dialog=useRef<HTMLDialogElement>(null);
  const [query,setQuery]=useState('');
  const [target,setTarget]=useState<{id:string;title:string}|null>(null);
  const [full,setFull]=useState(false);
  const [removing,setRemoving]=useState(false);
  const [error,setError]=useState('');
  const locked=disabled||removing;
  function cancel(){setTarget(null);setFull(false);setError('');}
  function close(){cancel();onClose();}
  async function remove(scope:'device'|'all'){
    if(!target||locked)return;
    setRemoving(true);setError('');
    try{await onDelete(target.id,scope);cancel();}
    catch(e){setError(e instanceof Error?e.message:'לא הצלחנו למחוק. נסו שוב.');}
    finally{setRemoving(false);}
  }
  useEffect(()=>{const d=dialog.current;if(open)d?.showModal();else d?.close();return()=>d?.close();},[open]);
  const list=entries.filter(c=>c.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <dialog ref={dialog} className="history-dialog" aria-labelledby="gemini-history-title" onClose={close} onClick={e=>{if(e.target===e.currentTarget&&!removing)close();}}>
    <div className="flex h-full flex-col p-4">
      <header className="mb-5 flex items-center justify-between"><div><p className="text-xs text-muted">Gemini</p><h2 id="gemini-history-title" className="text-lg font-semibold">השיחות שלך</h2></div><button className="ui-icon" disabled={removing} onClick={close} aria-label="סגירת רשימת השיחות"><X size={20}/></button></header>
      {target?<section className="rounded-2xl border border-line bg-surface p-4" aria-labelledby="delete-chat-title" aria-busy={removing}>
        <h3 id="delete-chat-title" className="mb-2 text-lg font-semibold">{full?'למחוק לצמיתות?':'איך להסיר את השיחה?'}</h3>
        <p className="mb-5 line-clamp-3 break-words text-sm text-muted" dir="auto">{target.title}</p>
        {full?<>
          <p className="mb-5 text-sm leading-relaxed">השיחה, התמונות והסרטונים יימחקו מהמערכת ומהארכיון. לא ניתן לבטל את המחיקה. השיחה באתר Gemini לא תימחק.</p>
          <button disabled={locked} className="ui-button mb-2 w-full bg-danger text-white" onClick={()=>void remove('all')}>{removing?'מוחק…':'מחיקה לצמיתות'}</button>
        </>:<div className="space-y-3">
          <button disabled={locked} className="w-full rounded-xl border border-line p-3 text-start hover:bg-bubble disabled:opacity-40" onClick={()=>void remove('device')}><span className="block font-medium">הסרה מהמכשיר</span><span className="mt-1 block text-sm text-muted">העותק בארכיון יישאר שמור.</span></button>
          <button disabled={locked} className="w-full rounded-xl border border-line p-3 text-start hover:bg-bubble disabled:opacity-40" onClick={()=>setFull(true)}><span className="block font-medium text-danger">מחיקה מלאה מהמערכת</span><span className="mt-1 block text-sm text-muted">כולל ההודעות והקבצים בארכיון.</span></button>
        </div>}
        {error&&<p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
        <button autoFocus disabled={locked} className="ui-button mt-3 w-full" onClick={cancel}>ביטול</button>
      </section>:<>
      <button disabled={disabled} className="ui-button ui-primary mb-4 w-full" onClick={()=>onSelect(null)}><SquarePen size={18}/>שיחה חדשה</button>
      <label className="ui-search mb-5"><Search size={17} aria-hidden/><input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="חיפוש שיחה" aria-label="חיפוש שיחות Gemini"/></label>
      <nav aria-label="שיחות Gemini" className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {list.map(c=><div key={c.id} className="flex items-center gap-1"><button disabled={locked} onClick={()=>onSelect(c.id)} aria-current={selected===c.id?'page':undefined} className="history-item min-w-0 flex-1"><MessageCircle size={17} className="shrink-0" aria-hidden/><span className="truncate" dir="auto">{c.title}</span></button><button disabled={locked} className="ui-icon" aria-label={`מחיקת השיחה: ${c.title}`} onClick={()=>{setTarget(c);setFull(false);setError('');}}><Trash2 size={17} aria-hidden/></button></div>)}
        {!list.length&&<p className="py-8 text-center text-sm text-muted">{query?'לא נמצאו שיחות':'השיחה הראשונה שלך מתחילה כאן'}</p>}
      </nav>
      </>}
    </div>
  </dialog>;
}
