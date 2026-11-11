// Readiness check; optional disposable probe verifies actual Postgres and Storage.
// node --env-file=.env.local scripts/check-archive.mjs --probe
import {randomUUID,randomBytes} from 'node:crypto';
const base=process.env.SUPABASE_URL, key=process.env.SUPABASE_SECRET_KEY;
if(!base||!key)throw new Error('Missing archive configuration');
async function request(path,method='GET',body,headers={}){
  const r=await fetch(base+path,{method,headers:{apikey:key,'User-Agent':'ai-chat-server-check/1.0','Content-Type':'application/json',...headers},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});
  if(!r.ok)throw new Error(`Archive readiness failed (HTTP ${r.status})`);
  return r;
}
await request('/rest/v1/archive_conversations?select=id&limit=0');
const bucket=await(await request('/storage/v1/bucket/chat-archive')).json();
if(bucket.public!==false)throw new Error('Archive bucket must be private');
console.log('PASS: archive tables reachable; bucket is private');
if(process.argv.includes('--probe')){
  const id=randomUUID(),turn=randomUUID(),asset=randomUUID(),owner=randomBytes(32).toString('hex');
  try{
    await request('/rest/v1/archive_conversations','POST',{id,owner,title:'Disposable connection probe'});
    await request('/storage/v1/object/chat-archive/'+id+'/'+asset,'POST','archive verification',{'Content-Type':'text/plain'});
    const content=await(await request('/storage/v1/object/chat-archive/'+id+'/'+asset)).text();if(content!=='archive verification')throw new Error('File roundtrip mismatch');
    const body={p_owner:owner,p_conversation:id,p_id:turn,p_hash:'test',p_model:'flash',p_input:'disposable probe',p_assets:[]};
    const first=await(await request('/rest/v1/rpc/archive_begin_turn','POST',body)).json();
    const duplicate=await(await request('/rest/v1/rpc/archive_begin_turn','POST',body)).json();
    if(first!==true||duplicate!==false)throw new Error('Atomic request claim failed');
    console.log('PASS: real database and original file roundtrip; duplicate claim prevented');
  }finally{
    await request('/rest/v1/archive_turns?id=eq.'+turn,'DELETE');
    await request('/storage/v1/object/chat-archive','DELETE',{prefixes:[id+'/'+asset]});
    await request('/rest/v1/archive_conversations?id=eq.'+id,'DELETE');
    console.log('Disposable probe removed');
  }
}
