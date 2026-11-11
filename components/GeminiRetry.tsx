'use client';
import {useEffect,useRef} from 'react';
import type {ArchiveTurn} from '@/lib/archive/types';
export default function GeminiRetry({turn,busy,error,disabled,onCancel,onConfirm}:{turn:ArchiveTurn|null;busy:boolean;error:string;disabled:boolean;onCancel:()=>void;onConfirm:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const d=dialog.current;if(turn)d?.showModal();else d?.close();return()=>d?.close();},[turn]);
  return <dialog ref={dialog} className="confirm-dialog" aria-labelledby="retry-title" aria-describedby="retry-description" onCancel={e=>{e.preventDefault();if(!busy)onCancel();}}>
    <h2 id="retry-title" className="text-lg font-semibold">לשלוח את הבקשה מחדש?</h2>
    <p id="retry-description" className="mt-3 text-sm text-muted">תישלח בקשה חדשה עם אותו טקסט, אותם קבצים ואותו סוג יצירה.</p>
    {disabled&&!busy&&<p role="status" className="mt-3 text-sm text-muted">לא ניתן לשלוח כעת. ממתינים לעדכון מצב החיבור או הבקשה הפעילה.</p>}
    {error&&<p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
    <div className="mt-6 flex flex-wrap gap-3"><button autoFocus disabled={busy} onClick={onCancel} className="ui-button flex-1">ביטול</button><button disabled={busy||disabled} onClick={onConfirm} className="ui-button ui-primary flex-1">{busy?'שולח…':'שליחה מחדש'}</button></div>
  </dialog>;
}
