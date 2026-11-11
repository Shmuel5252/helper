import {mkdir,readFile,writeFile,rename,rmdir,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {ImageJob} from './realistic-image.ts';
type State={jobs:ImageJob[];health?:{state:string;seen_at:string}};
export const LEASE_MS=600000;
const active=(j:ImageJob)=>['queued','claimed','generating'].includes(j.phase);
// Atomic replacement and an OS-visible lock protect concurrent Next handlers/processes.
export class LocalImageQueue{
  dir:string;
  constructor(dir:string){this.dir=dir;}
  async transaction<T>(fn:(state:State)=>T|Promise<T>):Promise<T>{
    await mkdir(this.dir,{recursive:true});const lock=join(this.dir,'queue.lock');
    const deadline=Date.now()+10000;
    for(;;){
      try{await mkdir(lock);break;}catch(e){
        if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;
        const s=await stat(lock).catch(()=>null);
        if(s&&Date.now()-s.mtimeMs>60000)await rmdir(lock).catch(()=>{});
        if(Date.now()>deadline)throw Error('Queue busy');
        await new Promise(r=>setTimeout(r,30));
      }
    }
    try{
      let state:State;
      try{state=JSON.parse(await readFile(join(this.dir,'queue.json'),'utf8'));}
      catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;state={jobs:[]};}
      const result=await fn(state);
      const temp=join(this.dir,randomUUID()+'.tmp');
      await writeFile(temp,JSON.stringify(state),{mode:0o600});
      await rename(temp,join(this.dir,'queue.json'));
      return result;
    }finally{await rmdir(lock);}
  }
  list(){return this.transaction(s=>s.jobs);}
  get(id:string){return this.transaction(s=>s.jobs.find(j=>j.id===id)??null);}
  enqueue(job:ImageJob){return this.transaction(s=>{
    const old=s.jobs.find(j=>j.id===job.id);
    if(old){if(old.owner!==job.owner||old.request_hash!==job.request_hash)throw Error('Conflict');return old;}
    const today=Date.now()-86400000;
    if(s.jobs.filter(j=>j.owner===job.owner&&Date.parse(j.created_at)>today).length>=20||s.jobs.filter(j=>Date.parse(j.created_at)>today).length>=100||s.jobs.filter(j=>j.owner===job.owner&&active(j)).length>=3||s.jobs.filter(active).length>=50)throw Error('Quota');
    s.jobs.push(job);return job;
  });}
  health(state?:string){return this.transaction(s=>{
    if(state)s.health={state,seen_at:new Date().toISOString()};
    return s.health;
  });}
  claim(token:string,now=Date.now()){return this.transaction(s=>{
    for(const j of s.jobs){
      if(['claimed','generating'].includes(j.phase)&&Date.parse(j.lease_until??'')<=now){
        j.phase=j.phase==='generating'?'uncertain':'queued';j.token=null;
      }
      if(j.phase==='queued'&&now-Date.parse(j.created_at)>7*86400000){j.phase='failed';j.error='הבקשה פגה לאחר שבעה ימים בתור.';}
    }
    if(s.jobs.some(j=>['claimed','generating'].includes(j.phase)))return null;
    const j=s.jobs.find(j=>j.phase==='queued'&&(!j.not_before||Date.parse(j.not_before)<=now));
    if(!j)return null;
    Object.assign(j,{phase:'claimed',token,lease_until:new Date(now+LEASE_MS).toISOString(),updated_at:new Date(now).toISOString()});return j;
  });}
  update(id:string,token:string,action:string,data:{image_id?:string;error?:string}={}){return this.transaction(s=>{
    const j=s.jobs.find(j=>j.id===id&&j.token===token);if(!j)return false;
    if(j.phase==='done'&&action==='complete')return true;
    if(!['claimed','generating'].includes(j.phase)||Date.parse(j.lease_until??'')<=Date.now())return false;
    if(action==='renew')j.lease_until=new Date(Date.now()+LEASE_MS).toISOString();
    else if(action==='start'&&j.phase==='claimed')j.phase='generating';
    else if(action==='defer'){j.phase='queued';j.token=null;j.not_before=new Date(Date.now()+5000).toISOString();}
    else if(action==='complete'&&j.phase==='generating'){j.phase='done';j.image_id=data.image_id;}
    else if(action==='fail'){j.phase=j.phase==='generating'?'uncertain':'failed';j.error=data.error;}
    else return false;
    j.updated_at=new Date().toISOString();return true;
  });}
}
