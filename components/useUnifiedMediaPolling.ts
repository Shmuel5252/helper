"use client";
import {useEffect,useRef} from 'react';
import type {Conversation,MediaResult} from '@/lib/history';
import type {ArchiveTranscript} from '@/lib/archive/types';
import {requestJson as api,RequestError} from '@/lib/gemini-progress';
import {watchUpdates} from '@/lib/gemini-polling';
import {mediaPatch} from '@/lib/unified-chat';

export function useMediaPolling(convs:Conversation[]|null,update:(id:string,patch:Partial<MediaResult>)=>void,onSettled:()=>void){
  const current=useRef({convs,update,onSettled});
  useEffect(()=>{current.current={convs,update,onSettled};});
  const key=(convs??[]).flatMap(c=>c.messages).filter(m=>m.media?.jobId&&(!m.media.provider||m.media.conversationId)&&(m.media.status==='pending'||!!m.media.provider&&m.media.status==='stopped')).map(m=>m.media!.jobId).sort().join('|');
  useEffect(()=>{
    if(!key)return;
    let cancelled=false;
    const missing=new Map<string,number>();
    async function poll(){
      const jobs=(current.current.convs??[]).flatMap(c=>c.messages).map(m=>m.media).filter((m):m is MediaResult=>!!m?.jobId&&(!m.provider||!!m.conversationId)&&(m.status==='pending'||!!m.provider&&m.status==='stopped'));
      for(const job of jobs){
        if(cancelled)return;
        try{
          let patch:Partial<MediaResult>;
          if(job.provider==='account'||job.provider==='fal'){
            const data=await api<ArchiveTranscript>(`/api/gemini/conversations/${job.conversationId}`);
            let turn=data.turns.find(t=>t.id===job.jobId);
            if(!turn){
              const since=missing.get(job.jobId!)??Date.now();missing.set(job.jobId!,since);
              if(Date.now()-since<60000)continue;
              patch={status:'failed',error:'לא התקבל אישור לשליחה. אפשר לנסות שוב.'};
            }else{
              missing.delete(job.jobId!);
              if(['starting','running'].includes(turn.status)){
                await api(`/api/gemini/turns/${turn.id}`,{method:'POST'});
                const fresh=await api<ArchiveTranscript>(`/api/gemini/conversations/${job.conversationId}`);
                turn=fresh.turns.find(t=>t.id===job.jobId)??turn;
              }
              patch=mediaPatch(turn);
              if(job.status==='stopped'&&patch.status==='pending')continue;
            }
          }else{
            const result=await api<{status:string;url?:string;poster?:string;credits?:number;error?:string}>(`/api/media/status?id=${encodeURIComponent(job.jobId!)}`);
            if(result.status==='running')continue;
            patch=result.status==='done'?{status:'done',url:result.url,poster:result.poster,credits:result.credits}:{status:'failed',error:result.error??'היצירה נכשלה.'};
          }
          if(cancelled)return;
          if(patch.status!==job.status||patch.url!==job.url||patch.error!==job.error)current.current.update(job.jobId!,patch);
          if(patch.status==='done'||patch.status==='failed')current.current.onSettled();
        }catch(e){
          // Keep known progress during a lost connection; never resubmit a generation.
          if(!cancelled&&e instanceof RequestError&&e.status===404)current.current.update(job.jobId!,{status:'failed',error:'הבקשה לא נמצאה. אפשר לנסות שוב.'});
        }
      }
    }
    const stop=watchUpdates(poll,window,document,5000);
    return()=>{cancelled=true;stop();};
  },[key]);
  return {stop:(id:string)=>update(id,{status:'stopped'}),resume:(id:string)=>update(id,{status:'pending'})};
}
