import {GeminiBrowser} from './browser.mjs';
import {executeJob} from './lifecycle.mjs';
import {WorkerLease} from './lease.mjs';
const base=new URL(process.env.APP_ORIGIN);
if(base.protocol!=='https:'||base.hostname!=='helper-zeta-eight.vercel.app'||!process.env.GEMINI_WORKER_SECRET)throw Error('Worker configuration missing');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function api(action,data={}){
  const {id,token,state,url,mime,size,sha256}=data;
  const payload={action,id,token,state,url,mime,size,sha256,...(['reserve','response'].includes(action)?{text:data.text??''}:{})};
  const r=await fetch(new URL('/api/worker/gemini',base),{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.GEMINI_WORKER_SECRET}`},body:JSON.stringify(payload),signal:AbortSignal.timeout(action==='claim'?65000:25000)});
  if(!r.ok){const e=Error('worker-request');e.status=r.status;throw e;}
  return r.json();
}
async function upload(url,bytes,mime){
  const u=new URL(url);
  if(u.protocol!=='https:'||u.hostname!==process.env.STORAGE_HOST||!u.pathname.startsWith('/storage/v1/object/upload/sign/chat-archive/'))throw Error('invalid-upload-url');
  const r=await fetch(u,{method:'PUT',redirect:'error',headers:{'Content-Type':mime},body:bytes,signal:AbortSignal.timeout(60000)});
  // A lost upload acknowledgement is safe: immutable object is verified by complete.
  if(!r.ok&&r.status!==409&&r.status!==400)throw Error('upload-failed');
}
const adapter=new GeminiBrowser();
for(;;){
  try{
    const ready=await adapter.ready();
    await api('heartbeat',{state:ready?'ready':'login'});
    if(!ready){await pause(15000);continue;}
    const {job}=await api('claim');
    if(!job){await pause(10000);continue;}
    console.log('job claimed',job.id);
    let renewing=false,renewAt=Date.now()+15000;
    const lease=new WorkerLease(Date.parse(job.leaseUntil));
    const deadline=Date.now()+18*60000;
    const check=()=>{lease.check();if(Date.now()>deadline)throw Error('job-deadline');};
    const timer=setInterval(async()=>{
      if(renewing||Date.now()<renewAt)return;renewing=true;
      const started=Date.now();
      try{await api('renew',job);lease.renewed(started);renewAt=Date.now()+15000;}
      catch(e){lease.failed(e.status);renewAt=Date.now()+3000;}
      finally{renewing=false;}
      // Health reporting is not a claim acknowledgement and cannot revoke it.
      await api('heartbeat',{state:'ready'}).catch(()=>{});
    },3000);
    try{
      await executeJob(job,{api,adapter,upload,check});console.log('job archived',job.id);
    }catch(e){
      console.error('job stopped',job.id,e.status??e.message?.replace(/[^a-z-]/gi,'').slice(0,60));
      await api('fail',job).catch(()=>{});
    }finally{clearInterval(timer);await adapter.cleanup();}
  }catch(e){console.error('worker unavailable',e.status??e.name);await pause(15000);}
}
