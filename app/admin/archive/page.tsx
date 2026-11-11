import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { admin } from '@/lib/archive/identity';
import { db } from '@/lib/archive/store';
import { transcript } from '@/lib/archive/service';
import { uuid } from '@/lib/archive/validation';
import type { ArchiveConversation, ArchiveTranscript } from '@/lib/archive/types';
import ArchiveWorkspace from '@/components/ArchiveWorkspace';
import { browserHealth } from '@/lib/archive/browser-jobs';
import { falSelected, falReady } from '@/lib/archive/fal-jobs';
export const metadata={title:'הארכיון שלי'};

async function Panel({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const params=await searchParams;
  if(!process.env.ADMIN_CODE)notFound();
  if(!await admin())return <form action="/api/admin/login" method="post" className="owner-login">
    <p className="text-sm text-muted">צ׳אט AI</p><h1 className="mt-2 text-2xl font-semibold">הארכיון שלי</h1><p className="mt-2 mb-7 text-sm text-muted">הכניסה באמצעות קוד הניהול שלך</p>
    <input type="hidden" name="next" value="/admin/archive"/>
    <label htmlFor="code" className="sr-only">קוד ניהול</label><input id="code" name="code" type="password" required autoComplete="current-password" placeholder="קוד ניהול" className="h-12 w-full rounded-2xl border border-line bg-bg px-4"/>
    {params.e&&<p role="alert" className="mt-3 text-danger">קוד הניהול שגוי.</p>}
    <button className="ui-button ui-primary mt-4 w-full">כניסה</button>
  </form>;
  const offset=Math.min(1_000_000,Math.max(0,Math.floor(Number(params.offset)||0)));
  const query=typeof params.q==='string'?params.q.trim().slice(0,120):'';
  let list:ArchiveConversation[]=[];let data:ArchiveTranscript|null=null;let error=false;
  try {
    list=await db<ArchiveConversation[]>('archive_conversations',`order=updated_at.desc&limit=50&offset=${offset}${query?`&title=ilike.*${encodeURIComponent(query.replace(/[%*_]/g,''))}*`:''}`);
    if(uuid(params.id))data=await transcript(params.id);
  }catch{error=true;}
  const useFal=falSelected();
  const health=useFal?null:await browserHealth();
  const status=useFal?(falReady()?'מוגדר':'טרם הופעל'):health?.ready?'מחובר':health?.state==='login'?'נדרשת כניסה בשרת':'לא זמין כרגע';
  return <><p className="px-5 pt-4 text-sm text-muted">חיבור {useFal?'fal':'Gemini'}: {status}</p><ArchiveWorkspace list={list.map(({owner,...c})=>{void owner;return c;})} data={data} offset={offset} query={query} error={error}/></>;
}
export default function Page(props:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  return <div className="min-h-dvh"><Suspense fallback={<p role="status" className="p-8 text-center text-muted">טוען את השיחות…</p>}><Panel {...props}/></Suspense></div>;
}
