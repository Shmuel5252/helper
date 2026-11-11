'use client';
/* eslint-disable @next/next/no-img-element */
import { useRef, useState } from 'react';
import { Download, Maximize2, X } from 'lucide-react';
import type { ArchiveAsset } from '@/lib/archive/types';

export default function ArchiveFile({ asset }: { asset: ArchiveAsset }) {
  const url = `/api/gemini/assets/${asset.id}`;
  const isImage = asset.mime.startsWith('image/');
  const isVideo = asset.mime.startsWith('video/');
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const viewer = useRef<HTMLDialogElement>(null);
  const src = attempt ? `${url}?retry=${attempt}` : url;
  return <>
    {(isImage || isVideo) && <div className="relative overflow-hidden rounded-2xl border border-line bg-bubble/40">
      {state !== 'ready' && <div className="flex aspect-video flex-col items-center justify-center gap-3 px-4 text-center text-sm text-muted" role="status">
        {state === 'loading' ? <><span className="dots flex gap-1" aria-hidden="true"><span/><span/><span/></span>טוען תצוגה…</> : <>
          <p>לא הצלחנו להציג {isImage ? 'את התמונה' : 'את הסרטון'} כרגע.</p>
          <button className="rounded-full border border-line px-4 py-2 text-fg" onClick={() => { setState('loading'); setAttempt(n => n + 1); }}>טעינה מחדש</button>
        </>}
      </div>}
      {isImage ? <button type="button" onClick={() => viewer.current?.showModal()} aria-label="הגדלת התמונה" className={`group relative w-full ${state === 'ready' ? 'block' : 'hidden'}`}>
        <img key={src} src={src} alt={asset.name} onLoad={() => setState('ready')} onError={() => setState('error')} className="mx-auto max-h-[520px] min-h-40 w-full object-contain" />
        <span className="absolute end-3 bottom-3 rounded-full bg-black/50 p-2 text-white opacity-70 transition-opacity group-hover:opacity-100"><Maximize2 size={17} aria-hidden="true"/></span>
      </button> : <video key={src} src={src} controls playsInline preload="metadata" aria-label="הסרטון שנוצר" onLoadedMetadata={() => setState('ready')} onError={() => setState('error')} className={`max-h-[520px] w-full ${state === 'ready' ? 'block' : 'hidden'}`} />}
    </div>}
    <a href={`${url}?download=1`} download className="mt-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-muted hover:bg-bubble hover:text-fg" aria-label={`הורדת ${asset.name}`}>
      <Download size={14} aria-hidden="true"/>{isImage || isVideo ? 'שמירה למכשיר' : asset.name}
    </a>
    {isImage && <dialog ref={viewer} aria-label="תצוגת תמונה" className="fixed inset-0 m-auto max-h-[95dvh] max-w-[95vw] overflow-visible rounded-2xl border border-line bg-surface p-2 text-fg backdrop:bg-black/80" onClick={e => { if (e.target === e.currentTarget) viewer.current?.close(); }}>
      <button type="button" aria-label="סגירת התמונה" onClick={() => viewer.current?.close()} className="absolute end-3 top-3 rounded-full bg-black/60 p-2 text-white"><X size={22}/></button>
      <img src={src} alt={asset.name} className="max-h-[88dvh] max-w-[90vw] rounded-xl object-contain"/>
    </dialog>}
  </>;
}
