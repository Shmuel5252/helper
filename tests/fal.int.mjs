import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const base='http://localhost:3116';let cookie='';
async function api(path,body,method=body?'POST':'GET'){
  const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',cookie,origin:base},...(body?{body:JSON.stringify(body)}:{})});
  const set=r.headers.getSetCookie();if(set.length)cookie=[...cookie.split('; ').filter(Boolean),...set.map(s=>s.split(';')[0])].join('; ');
  return r;
}
const login=await fetch(base+'/api/login',{method:'POST',body:new URLSearchParams({code:'test-access'}),redirect:'manual'});assert.equal(login.status,303);
cookie=login.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');
const config=await(await api('/api/gemini/config')).json();assert.equal(config.available,true);assert.deepEqual(config.models.map(m=>m.key),['fal-image-v1','fal-video-v1']);
assert.equal((await fetch(base+'/api/fal/webhook?turn='+randomUUID(),{method:'POST',body:'{}'})).status,401);
const cid=randomUUID();assert.equal((await api('/api/gemini/conversations',{id:cid,title:'isolated fal test'})).status,200);
const stats=()=>fetch('http://localhost:4042/control').then(r=>r.json());
const transcript=()=>api('/api/gemini/conversations/'+cid).then(r=>r.json());
let source;
for(const kind of ['image','video']){
  const before=(await stats()).calls,id=randomUUID();
  const body={id,conversationId:cid,modelKey:`fal-${kind}-v1`,text:'boat '+kind,assets:kind==='video'?[source]:[]};
  assert.equal((await api('/api/gemini/turns',body)).status,200);
  // Replay/parallel retries are deduplicated in storage before any paid submit.
  await Promise.all([api('/api/gemini/turns',body),api('/api/gemini/turns',body)]);
  assert.equal((await stats()).calls,before+1);
  if(kind==='video'){
    const state=await stats();assert.equal(state.lastInput.endpoint,'/minimax/h3-max-turbo/image-to-video');assert.ok(state.lastInput.input.image_url.startsWith('data:image/png;base64,'));
  }
  if(kind==='image')assert.equal((await api('/api/gemini/turns/'+id,null,'POST')).status,200);
  else {
    // Simulates closing the chat: signed callback archives without client polling.
    const rows=await fetch('http://localhost:4040/rest/v1/archive_turns?id=eq.'+id,{headers:{apikey:'mock-supabase-secret'}}).then(r=>r.json());
    const job=JSON.parse(rows[0].provider_id);
    const callback=()=>fetch('http://localhost:4042/callback',{method:'POST',body:JSON.stringify({requestId:job.requestId})}).then(r=>r.json());
    await fetch('http://localhost:4040/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({failStorage:true})});
    assert.equal((await callback()).status,503);
    await fetch('http://localhost:4040/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({failStorage:false})});
    assert.equal((await transcript()).turns.find(t=>t.id===id).status,'running');
    assert.equal((await callback()).status,200);assert.equal((await callback()).status,200);
  }
  const data=await transcript();const turn=data.turns.find(t=>t.id===id);
  assert.equal(turn.status,'completed');assert.equal(turn.output[0].type,kind);
  const asset=turn.output[0].assetId;if(kind==='image')source=asset;
  const file=await api('/api/gemini/assets/'+asset);assert.equal(file.status,200);assert.ok((await file.arrayBuffer()).byteLength>10);
  assert.equal(data.assets.filter(a=>a.id===asset).length,1);
  assert.equal(turn.provider_id,null);
}
for(const prompt of ['refusal','no-credits','ambiguous']){
  const id=randomUUID(),body={id,conversationId:cid,modelKey:'fal-image-v1',text:prompt,assets:[]};
  const before=(await stats()).calls;assert.equal((await api('/api/gemini/turns',body)).status,200);
  await api('/api/gemini/turns/'+id,null,'POST');
  const turn=(await transcript()).turns.find(t=>t.id===id);
  assert.equal(turn.status,prompt==='ambiguous'?'uncertain':'failed');assert.ok(turn.error);
  if(prompt==='no-credits')assert.equal(turn.error,'לא הצלחנו ליצור.');
  await api('/api/gemini/turns',body);assert.equal((await stats()).calls,before+1);
}
assert.equal((await api('/api/gemini/turns',{id:randomUUID(),conversationId:cid,modelKey:'account-video',text:'old tab',assets:[]})).status,409);
const preserved=await transcript();
assert.equal((await api('/api/gemini/conversations/'+cid,null,'DELETE')).status,200);
assert.deepEqual(await transcript(),preserved);
const other=await fetch(base+'/api/gemini/conversations/'+cid);assert.equal(other.status,401);
// Repeated explicit requests pass the former daily allowance in this local simulator.
for(let n=0;n<8;n++){
  const id=randomUUID(),before=(await stats()).calls;
  await api('/api/gemini/turns',{id,conversationId:cid,modelKey:'fal-video-v1',text:'budget',assets:[]});
  const turn=(await transcript()).turns.find(t=>t.id===id);
  assert.equal(turn.status,'running');assert.equal((await stats()).calls,before+1);
  await api('/api/gemini/turns/'+id,null,'POST');
}
console.log('PASS: queue modes, image-to-video, signed webhook without polling, duplicate protection, archive files, refusal, generic credit failure, ambiguity, old-client block, local deletion retention, privacy, no daily cap. No external requests.');
