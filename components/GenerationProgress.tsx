import QuietMark from './QuietMark';
import type {ProgressState} from '@/lib/gemini-progress';

export default function GenerationProgress({ kind, state='processing',stale=false }: { kind: 'chat' | 'image' | 'video'; state?:ProgressState;stale?:boolean }) {
  if(state!=='processing'){
    const copy={
      waiting:['ממתין לעדכון','כרגע אין עדכון על הבקשה. נבדוק שוב אוטומטית, בלי לשלוח אותה מחדש.'],
      queued:['הבקשה ממתינה לטיפול',stale?'זה המצב האחרון שהתקבל. החיבור מתעדכן…':'נעדכן כאן כשיתקבל שינוי במצב.'],
      stopped:['היצירה נעצרה','לא התקבלה תוצאה.'],
      uncertain:['היצירה לא הושלמה','אפשר לשלוח שוב.'],
    }[state];
    return <div role="status" aria-live="polite" className="rounded-2xl border border-line bg-surface px-5 py-6 text-center"><p className="font-medium">{copy[0]}</p><p className="mt-2 text-sm text-muted">{copy[1]}</p></div>;
  }
  if (kind === 'chat') return <div role="status" className="flex items-center gap-3 py-5 text-sm text-muted">
    <span className="dots flex gap-1" aria-hidden="true"><span/><span/><span/></span>חושב…
  </div>;
  return <div role="status" aria-live="polite" className={`generation-preview ${kind === 'video' ? 'aspect-video' : 'aspect-[4/3]'}`}>
    {!stale&&<QuietMark compact />}
    <p className="mt-2 font-medium">הבקשה בטיפול</p>
    <p className="mt-1 px-4 text-center text-sm text-muted">{stale?'זה המצב האחרון שהתקבל. החיבור מתעדכן…':'התוצאה או התשובה יופיעו כאן בסיום.'}</p>
    {!stale&&<div className="generation-track mt-5" aria-hidden="true"><span/></div>}
  </div>;
}
