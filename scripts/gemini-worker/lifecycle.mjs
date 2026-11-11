import {createHash} from 'node:crypto';
export async function executeJob(job,{api,adapter,upload,pause=(ms)=>new Promise(r=>setTimeout(r,ms)),check}){
  if(job.source)await adapter.resume(job);else await adapter.prepare(job);
  check();
  // A lost response here must never result in sending an unrecorded generation.
  await api('submit',job);check();
  if(!job.source)await adapter.submit();
  const result=await adapter.result(job,check,async url=>api('source',{...job,url}));check();
  if(result.terminalText){
    for(let attempt=0;attempt<6;attempt++){
      check();
      try{await api('response',{id:job.id,token:job.token,text:result.terminalText});return {stopped:true};}
      catch(e){if(e.status===409||e.status===401||attempt===5)throw e;await pause(5000);}
    }
  }
  const sha256=createHash('sha256').update(result.bytes).digest('hex');
  // Retain bytes during transient storage errors; never ask Gemini to regenerate.
  for(let attempt=0;attempt<6;attempt++){
    check();
    try{
      const signed=await api('reserve',{id:job.id,token:job.token,mime:result.mime,size:result.bytes.length,sha256,text:result.text??''});
      await upload(signed.url,result.bytes,result.mime);
      await api('complete',job);
      return {sha256,size:result.bytes.length};
    }catch(e){if(e.status===409||e.status===401||attempt===5)throw e;await pause(5000);}
  }
}
