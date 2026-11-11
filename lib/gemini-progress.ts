import type {ArchiveTurn} from './archive/types';

export type ProgressState='queued'|'processing'|'waiting'|'stopped'|'uncertain';
export function updatesStale(connected:boolean,updatedAt:number,now:number){return !connected||!updatedAt||now-updatedAt>30000;}
export function progressState(status:ArchiveTurn['status'],connected:boolean,updatedAt:number,now:number):ProgressState|null{
  void connected;void now;
  if(status==='completed')return null;
  if(status==='failed')return 'stopped';
  if(status==='uncertain')return 'uncertain';
  if(!updatedAt)return 'waiting';
  return status==='starting'?'queued':'processing';
}
export class RequestError extends Error {
  readonly status:number;
  constructor(message:string,status:number){super(message);this.status=status;}
}
// A failed read may be retried by polling. A submission is never retried here.
export async function requestJson<T>(url:string,init:RequestInit={},fetcher:typeof fetch=fetch):Promise<T>{
  let response:Response;
  try{response=await fetcher(url,{...init,cache:'no-store',signal:init.signal??AbortSignal.timeout(15000)});}
  catch{throw new RequestError('החיבור נקטע. לא התקבל אישור לפעולה. בדקו את מצב הבקשה לפני ניסיון נוסף.',0);}
  let data;
  try{data=await response.json();}
  catch{throw new RequestError('לא התקבל עדכון תקין. ננסה לבדוק את המצב שוב.',response.ok?0:response.status);}
  if(!response.ok)throw new RequestError(data.error||'לא הצלחנו להשלים את הפעולה. נסו שוב.',response.status);
  return data;
}
