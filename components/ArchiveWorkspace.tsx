'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { ArrowRight, MessageCircle, RefreshCw, Search, Trash2, X } from 'lucide-react';
import ArchiveMessages from './ArchiveMessages';
import QuietMark from './QuietMark';
import type { ArchiveConversation, ArchiveTranscript } from '@/lib/archive/types';

type Props={list:Omit<ArchiveConversation,'owner'>[];data:ArchiveTranscript|null;offset:number;query:string;error:boolean};
export default function ArchiveWorkspace({list,data,offset,query,error}:Props){
  const router=useRouter(),dialog=useRef<HTMLDialogElement>(null);
  const [busy,setBusy]=useState(false),[deleteError,setDeleteError]=useState('');
  const url=(start:number,id?:string)=>`/admin/archive?${new URLSearchParams({offset:String(start),...(query?{q:query}:{}),...(id?{id}:{})})}`;
  const pending=data?.turns.some(t=>['starting','running'].includes(t.status));
  async function remove(){
    if(busy||!data)return;
    setBusy(true);setDeleteError('');
    try{
      const response=await fetch('/api/admin/archive/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:data.conversation.id})});
      if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.error||'לא הצלחנו למחוק. נסו שוב.');}
      dialog.current?.close();router.replace(url(0));router.refresh();
    }catch(e){setDeleteError(e instanceof Error?e.message:'לא הצלחנו למחוק. נסו שוב.');}
    finally{setBusy(false);}
  }
  return <div className="archive-page">
    <header className="archive-header"><div><p className="mb-1 text-xs text-muted">צ׳אט AI</p><h1 className="text-2xl font-semibold tracking-tight">הארכיון שלי</h1></div><Link href="/" className="ui-button"><ArrowRight size={17} aria-hidden/>לצ׳אט</Link></header>
    {error&&<p role="alert" className="mb-4 text-danger">לא הצלחנו לטעון את השיחות. נסו לרענן.</p>}
    <div className="archive-layout" data-selected={!!data}>
      <aside className="archive-list">
        <form action="/admin/archive" className="ui-search"><Search size={17} aria-hidden/><input name="q" defaultValue={query} key={query} placeholder="חיפוש שיחה" aria-label="חיפוש בארכיון"/><button type="submit" className="sr-only">חיפוש</button></form>
        <div className="my-5 flex items-center justify-between text-xs text-muted"><span>השיחות שלך</span><Link href={url(offset)} className="ui-icon" aria-label="רענון הרשימה"><RefreshCw size={16}/></Link></div>
        <nav aria-label="שיחות בארכיון" className="space-y-1">
          {list.map(c=><Link key={c.id} href={url(offset,c.id)} aria-current={data?.conversation.id===c.id?'page':undefined} className="archive-item"><MessageCircle size={17} aria-hidden className="mt-1 shrink-0"/><div className="min-w-0"><span className="block truncate font-medium" dir="auto">{c.title}</span><time className="mt-1 block text-xs text-muted">{new Date(c.created_at).toLocaleDateString('he-IL',{timeZone:'Asia/Jerusalem',day:'numeric',month:'short'})}</time></div></Link>)}
        </nav>
        {!list.length&&!error&&<p className="py-8 text-sm text-muted">{query?'לא נמצאו שיחות מתאימות.':'עדיין אין שיחות בארכיון.'}</p>}
        <div className="mt-6 flex gap-3 text-sm">{offset>0&&<Link className="ui-button" href={url(Math.max(0,offset-50))}>הקודם</Link>}{list.length===50&&<Link className="ui-button" href={url(offset+50)}>הבא</Link>}</div>
      </aside>
      <main className="archive-content">
        {data?<>
          <Link href={url(offset)} className="ui-button mb-5 w-fit md:hidden"><ArrowRight size={17}/>כל השיחות</Link>
          <header className="flex items-start justify-between gap-4 border-b border-line pb-5"><div className="min-w-0"><h2 className="break-words text-xl font-medium" dir="auto">{data.conversation.title}</h2><p className="mt-1 text-xs text-muted">{data.turns.length} הודעות</p></div><div className="flex shrink-0 gap-1">
            <form action="/api/admin/archive/refresh" method="post"><input type="hidden" name="id" value={data.conversation.id}/><button className="ui-icon" aria-label="רענון שיחה" title="רענון שיחה"><RefreshCw size={18}/></button></form>
            <button className="ui-icon hover:text-danger" disabled={pending||busy} title={pending?'אפשר למחוק בסיום היצירה':'מחיקת השיחה'} aria-label="מחיקת השיחה" onClick={()=>{setDeleteError('');dialog.current?.showModal();}}><Trash2 size={18}/></button>
          </div></header>
          <ArchiveMessages turns={data.turns} assets={data.assets}/>
        </>:<div className="archive-empty"><QuietMark/><h2 className="mt-5 text-xl font-medium">מקום לחזור אליו</h2><p className="mt-2 text-sm text-muted">בחרו שיחה כדי לפתוח את ההודעות והיצירות שלה.</p></div>}
      </main>
    </div>
    <dialog ref={dialog} className="confirm-dialog" aria-labelledby="delete-title" aria-describedby="delete-description" onCancel={e=>{if(busy)e.preventDefault();}}>
      <div className="flex items-center justify-between"><span className="rounded-2xl bg-danger/10 p-3 text-danger"><Trash2 size={22}/></span><button disabled={busy} className="ui-icon" aria-label="סגירה" onClick={()=>dialog.current?.close()}><X size={20}/></button></div>
      <h2 id="delete-title" className="mt-5 text-xl font-semibold">למחוק את השיחה?</h2>
      <p className="mt-2 break-words font-medium" dir="auto">{data?.conversation.title}</p>
      <p id="delete-description" className="mt-3 text-sm leading-relaxed text-muted">ההודעות, התמונות והסרטונים יימחקו מהמערכת שלנו. אי אפשר לבטל את המחיקה. הפעולה לא מוחקת שיחות מחשבון Gemini.</p>
      {deleteError&&<p role="alert" className="mt-4 text-sm text-danger">{deleteError}</p>}
      <div className="mt-7 flex gap-3"><button autoFocus disabled={busy} className="ui-button flex-1" onClick={()=>dialog.current?.close()}>ביטול</button><button disabled={busy} onClick={()=>void remove()} className="ui-button delete-action flex-1">{busy?'מוחק…':'מחיקת השיחה'}</button></div>
    </dialog>
  </div>;
}
