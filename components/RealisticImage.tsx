'use client';
import {useEffect,useRef} from 'react';
import {Download,RefreshCw,Maximize2,Pencil} from 'lucide-react';
import type {Conversation,MediaResult} from '@/lib/history';
import type {ImageOverrides} from '@/lib/realistic-image';
import {requestJson as api,RequestError} from '@/lib/gemini-progress';
import {watchUpdates} from '@/lib/gemini-polling';

export function useRealisticPolling(convs:Conversation[]|null,update:(id:string,p:Partial<MediaResult>)=>void){
  const current=useRef({convs,update});useEffect(()=>{current.current={convs,update};});
  const key=(convs??[]).flatMap(c=>c.messages).filter(m=>m.media?.provider==='realistic'&&m.media.status==='pending').map(m=>m.media!.jobId).sort().join('|');
  useEffect(()=>{
    if(!key)return;let stopped=false;
    const stop=watchUpdates(async()=>{
      const jobs=(current.current.convs??[]).flatMap(c=>c.messages).map(m=>m.media).filter(m=>m?.provider==='realistic'&&m.status==='pending');
      for(const job of jobs){
        if(stopped)return;
        try{
          const p=await api<Partial<MediaResult>>(`/api/images/jobs/${job!.jobId}`);
          if(!stopped)current.current.update(job!.jobId!,{status:p.status,originalRequest:p.originalRequest,settings:p.settings,url:p.url,error:p.error,statusText:p.statusText,submission:undefined});
        }catch(e){
          if(!stopped&&!(e instanceof RequestError&&e.status===404))current.current.update(job!.jobId!,{statusText:'החיבור נקטע; בודק את הבקשה הקיימת…'});
        }
      }
    },window,document,4000);
    return()=>{stopped=true;stop();};
  },[key]);
}
export function ImageAdvanced({value,onChange,promptAI}:{value:ImageOverrides;onChange:(v:ImageOverrides)=>void;promptAI:boolean}){
  const set=(k:string,v:unknown)=>onChange({...value,[k]:v});
  return <details className="px-3 py-2 text-sm text-muted" dir="rtl">
    <summary className="cursor-pointer">הגדרות מתקדמות לתמונה · {Object.values(value).some(v=>v!==undefined)?'מותאם אישית':'אוטומטי'}</summary>
    <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
      <p className="col-span-full text-xs">{promptAI?'השארת השדות ריקים מפעילה בחירה אוטומטית לאיכות: 28–30 צעדים ו־512×512. יצירה עשויה להימשך יותר זמן. בחירה ידנית גוברת על האוטומטית.':'תרגום והרחבה באמצעות AI ממתינים לאישור פרטיות. אפשר ליצור מתיאור באנגלית.'}</p>
      <label className="col-span-full">תיאור באנגלית (לא חובה)<textarea aria-label="תיאור תמונה באנגלית" dir="ltr" maxLength={2000} value={value.prompt??''} onChange={e=>set('prompt',e.target.value||undefined)} className="mt-1 w-full rounded-xl border border-line bg-bg p-2"/></label>
      <label className="col-span-full">מה לא לכלול בתמונה<textarea aria-label="Negative prompt" dir="ltr" maxLength={2000} value={value.negative_prompt??''} onChange={e=>set('negative_prompt',e.target.value)} className="mt-1 w-full rounded-xl border border-line bg-bg p-2"/></label>
      {([{key:'steps',label:'צעדים',min:1,max:30,step:1,placeholder:'28'},{key:'guidance_scale',label:'Guidance',min:1.1,max:12,step:0.1,placeholder:'6'},{key:'seed',label:'Seed',min:-1,max:2147483647,step:1,placeholder:'אקראי'}] as const).map(f=><label key={f.key}>{f.label}<input aria-label={f.label} type="number" min={f.min} max={f.max} step={f.step} placeholder={f.placeholder} value={value[f.key]??''} onChange={e=>set(f.key,e.target.value===''?undefined:Number(e.target.value))} className="mt-1 w-full rounded-xl border border-line bg-bg p-2"/></label>)}
      {(['width','height'] as const).map(k=><label key={k}>{k==='width'?'רוחב':'גובה'}<select aria-label={k==='width'?'רוחב':'גובה'} value={value[k]??''} onChange={e=>set(k,e.target.value?Number(e.target.value):undefined)} className="mt-1 w-full rounded-xl border border-line bg-bg p-2"><option value="">אוטומטי · 512</option>{[256,320,384,448,512].map(n=><option key={n}>{n}</option>)}</select></label>)}
      <label>עוצמת השינוי בתמונה מצורפת<input aria-label="עוצמת שינוי" type="number" min={0.1} max={0.9} step={0.05} placeholder="0.65" value={value.strength??''} onChange={e=>set('strength',e.target.value?Number(e.target.value):undefined)} className="mt-1 w-full rounded-xl border border-line bg-bg p-2"/></label>
      <button type="button" onClick={()=>onChange({})} className="self-end rounded-xl border border-line p-2">חזרה לאוטומטי</button>
    </div>
  </details>;
}
export function RealisticImageCard({m,onView,onEdit,onVariant,onRetry,submitting}:{m:MediaResult;onView:(url:string)=>void;onEdit:(url:string)=>void;onVariant:(reuse:boolean)=>void;onRetry:()=>void;submitting:boolean}){
  const action='press flex items-center gap-1.5 rounded-full px-3 py-2 text-sm text-muted hover:bg-bubble hover:text-fg';
  return <div className="max-w-sm space-y-3" data-media-status={m.status} data-testid="realistic-image">
    {m.status==='pending'&&<div role="status" aria-live="polite" className="flex aspect-square flex-col items-center justify-center gap-4 rounded-3xl bg-bubble p-6 text-center"><div className="dots flex gap-1.5" aria-hidden><span/><span/><span/></div><p>{m.statusText||'מכין את התמונה…'}</p><p className="text-xs text-muted">אפשר לעבור לשיחה אחרת. הבקשה נשמרת בתור.</p></div>}
    {m.status==='failed'&&<p role="alert" className="text-danger">{m.error}</p>}
    {m.submission&&<button type="button" disabled={submitting} onClick={onRetry} className={action}>בדיקת השליחה מחדש — אותה בקשה</button>}
    {m.status==='done'&&m.url&&<>
      <button type="button" aria-label="הגדלת התמונה" onClick={()=>onView(m.url!)} className="block w-full overflow-hidden rounded-3xl bg-bubble">
        {/* eslint-disable-next-line @next/next/no-img-element -- private authenticated same-origin image */}
        <img src={m.url} alt={m.prompt} width={m.settings?.width??512} height={m.settings?.height??512} className="h-auto w-full"/>
      </button>
      <div className="flex flex-wrap gap-1">
        <a className={action} href={m.url+'?download=1'} download><Download size={16}/>הורדה</a>
        <button type="button" className={action} onClick={()=>onView(m.url!)}><Maximize2 size={16}/>הגדלה</button>
        <button type="button" className={action} onClick={()=>onEdit(m.url!)}><Pencil size={16}/>עריכת התמונה</button>
        <button type="button" className={action} onClick={()=>onVariant(false)}><RefreshCw size={16}/>גרסה נוספת</button>
        <button type="button" className={action} onClick={()=>onVariant(true)}>אותו Seed</button>
      </div>
    </>}
    {m.settings&&<details className="text-xs text-muted"><summary className="cursor-pointer">פרטי יצירה ושחזור</summary><dl className="mt-2 space-y-1"><dt>הבקשה המקורית</dt><dd dir="auto" className="whitespace-pre-wrap break-words">{m.originalRequest??m.prompt}</dd></dl><dl className="mt-2 space-y-1" dir="ltr"><dt>Seed: {m.settings.seed}</dt><dt>{m.settings.width} × {m.settings.height} · Steps {m.settings.steps} · Guidance {m.settings.guidance_scale}</dt><dt>Prompt</dt><dd className="whitespace-pre-wrap break-words">{m.settings.prompt}</dd><dt>Negative prompt</dt><dd>{m.settings.negative_prompt}</dd></dl><a className={action} href={`/api/images/jobs/${m.jobId}?download=metadata`} download><Download size={16}/>הורדת הבקשה ופרטי היצירה</a></details>}
  </div>;
}
