import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const base='http://localhost:3115';let cookie='';
async function api(path,body,method=body?'POST':'GET'){
  const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',cookie,origin:base},...(body?{body:JSON.stringify(body)}:{})});
  const set=r.headers.getSetCookie();if(set.length)cookie=set.map(s=>s.split(';')[0]).join('; ');
  return r;
}
const cid=randomUUID(),tid=randomUUID();
assert.equal((await api('/api/gemini/conversations',{id:cid,title:'Isolated unified test'})).status,200);
let r=await api('/api/chat',{messages:[{role:'user',content:'שלום'}],modelKey:'fast',archive:{id:tid,conversationId:cid,text:'שלום',assets:[]}});
assert.equal(r.status,200);const answer=await r.text();assert.ok(answer.length>0);
let data=await (await api('/api/gemini/conversations/'+cid)).json();
assert.equal(data.turns.length,1);assert.equal(data.turns[0].input,'שלום');assert.equal(data.turns[0].output[0].text,answer);assert.equal(data.turns[0].status,'completed');
assert.equal((await api('/api/chat',{messages:[{role:'user',content:'שלום'}],archive:{id:tid,conversationId:cid,text:'שלום',assets:[]}})).status,409);
for(const kind of ['image','video']){
  const id=randomUUID();assert.equal((await api('/api/gemini/turns',{id,conversationId:cid,modelKey:'account-'+kind,text:'Isolated '+kind,assets:[]})).status,200);
  await new Promise(r=>setTimeout(r,2200));
  data=await (await api('/api/gemini/conversations/'+cid)).json();
  const turn=data.turns.find(t=>t.id===id);assert.equal(turn.status,'completed');assert.equal(turn.output[0].type,kind);
  const file=await api('/api/gemini/assets/'+turn.output[0].assetId);assert.equal(file.status,200);assert.ok((await file.arrayBuffer()).byteLength>10);
}
const before=await (await api('/api/gemini/conversations/'+cid)).json();
r=await api('/api/gemini/conversations/'+cid,null,'DELETE');assert.equal(r.status,200);assert.equal((await r.json()).retained,true);
assert.deepEqual(await (await api('/api/gemini/conversations/'+cid)).json(),before);
const other=await fetch(base+'/api/gemini/conversations/'+cid);assert.notEqual(other.status,200);
const foreign=await api('/api/chat/archive',{id:randomUUID(),conversationId:randomUUID(),text:'unauthorized',assets:[],answer:'no'});assert.equal(foreign.status,404);
const redir=await fetch(base+'/gemini',{redirect:'manual'});assert.equal(redir.status,307);assert.equal(redir.headers.get('location'),'/');
console.log('PASS: text archived, duplicate rejected, image and video archived/readable, deletion preserves all content, owner isolation, old link redirects.');
