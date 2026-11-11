// Outbound-only worker; never opens a listening socket and never imports Python/models.
import {mkdir,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {normalizeSettings} from '../../lib/realistic-image.ts';
import {previewAccess} from './preview-auth.mjs';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const origin=new URL(process.env.IMAGE_APP_URL||'http://127.0.0.1:3000');
const previewHeaders=previewAccess(origin);
const local=['localhost','127.0.0.1','[::1]'].includes(origin.hostname);
if(origin.username||origin.password||(!local&&origin.protocol!=='https:'))throw Error('Invalid app origin');
if(!local&&process.env.IMAGE_CLOUD_CONSENT!=='approved-v1')throw Error('Cloud privacy approval required');
const secret=process.env.IMAGE_WORKER_SECRET;
if(!secret||secret.length<32)throw Error('IMAGE_WORKER_SECRET is required');
const apiOrigin=new URL(process.env.IMAGE_API_URL||'http://127.0.0.1:7860');
if(!['localhost','127.0.0.1','[::1]'].includes(apiOrigin.hostname)||apiOrigin.protocol!=='http:')throw Error('Image API must be loopback HTTP');
const dir=resolve(process.env.IMAGE_LOCAL_DATA_DIR||'.local-images','worker');
await mkdir(dir,{recursive:true});
const lock=join(dir,'worker.pid');
try{const pid=Number(await readFile(lock,'utf8'));let alive=false;try{process.kill(pid,0);alive=true;}catch{}if(alive)throw Error('Image worker already running');await unlink(lock);}catch(e){if(e.code!=='ENOENT')throw e;}
await writeFile(lock,String(process.pid),{flag:'wx',mode:0o600});
const journal=join(dir,'active.json');
async function save(value){const temp=journal+'.tmp';await writeFile(temp,JSON.stringify(value),{mode:0o600});await rename(temp,journal);}
let stopping=false,busy=false;
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{stopping=true;});
async function call(body){
  const headers={...await previewHeaders(),'Content-Type':'application/json',Authorization:'Bearer '+secret};
  // Optional Vercel automation bypass stays on this single allowlisted app origin.
  if(process.env.IMAGE_PREVIEW_BYPASS)headers['x-vercel-protection-bypass']=process.env.IMAGE_PREVIEW_BYPASS;
  const r=await fetch(new URL('/api/worker/images',origin),{method:'POST',headers,body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(40000)});
  if(!r.ok){const e=new Error('Worker request failed');e.status=r.status;throw e;}return r.json();
}
async function health(){try{const r=await fetch(new URL('/health',apiOrigin),{signal:AbortSignal.timeout(5000),redirect:'error'});const h=await r.json();return r.ok&&h.service==='realistic-vision-local-v1'&&h.model_available?(h.active_jobs?'busy':'ready'):'offline';}catch{return 'offline';}}
async function deliver(record){
  const r=await fetch(new URL('/images/'+record.imageId,apiOrigin),{signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!r.ok)throw Error('Image unavailable');const bytes=Buffer.from(await r.arrayBuffer());
  if(bytes.length>2000000)throw Error('Image exceeds upload limit');
  await call({action:'complete',id:record.job.id,token:record.job.token,imageId:record.imageId,png:bytes.toString('base64')});
}
async function recover(){
  let record;try{record=JSON.parse(await readFile(journal,'utf8'));}catch(e){if(e.code==='ENOENT')return;throw e;}
  try{
    if(record.imageId)await deliver(record);
    else await call({action:'fail',id:record.job.id,token:record.job.token});
  }catch(e){if(e.status!==409)throw e;}
  await unlink(journal);
}
async function run(job){
  busy=true;
  const renew=setInterval(()=>{void call({action:'renew',id:job.id,token:job.token}).catch(()=>{});},20000);
  try{
    await save({job});
    // Durable acknowledgement BEFORE dispatch: ambiguous requests can never be replayed.
    await call({action:'start',id:job.id,token:job.token});
    const source=job.settings.sourceAssetId?await call({action:'source',id:job.id,token:job.token}):null;
    const settings=normalizeSettings(job.settings);
    // Routing metadata stays in the queue; the engine receives the exact direct prompt.
    delete settings.promptMode;
    if(!source)delete settings.strength;
    const r=await fetch(new URL('/generate',apiOrigin),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...settings,...(source?{image_base64:source.image}:{})}),signal:AbortSignal.timeout(330000),redirect:'error'});
    if(r.status===429){await call({action:'defer',id:job.id,token:job.token});await unlink(journal);return;}
    if(!r.ok)throw Error('Generation failed');const result=await r.json();
    if(!/^[a-f0-9]{32}$/.test(result.id)||result.seed!==job.settings.seed)throw Error('Invalid generation response');
    const record={job,imageId:result.id};await save(record);await deliver(record);await unlink(journal);
    console.log('Image job completed');
  }catch{
    // Keep the journal: retry result delivery only, never retry /generate.
    console.warn('Image job interrupted; recovery will not regenerate it');
  }finally{clearInterval(renew);busy=false;}
}
const heartbeat=setInterval(()=>{void health().then(state=>call({action:'heartbeat',state:busy?'busy':state})).catch(()=>{});},20000);
console.log('Image worker started (outbound connections only)');
try{
  let lastState;
  while(!stopping){
    let delay=30000;
    try{
      await recover();
      const state=await health();
      if(state!==lastState){await call({action:'heartbeat',state});lastState=state;}
      if(state==='ready'){const {job}=await call({action:'claim'});if(job){await run(job);lastState=undefined;delay=1000;}}
    }catch{console.warn('Image service unavailable; waiting safely');}
    if(!stopping)await sleep(delay);
  }
}finally{clearInterval(heartbeat);await call({action:'heartbeat',state:'offline'}).catch(()=>{});await unlink(lock).catch(()=>{});}
