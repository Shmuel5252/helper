import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const base=process.env.TEST_URL??'http://localhost:3110';
const control=(body)=>fetch('http://localhost:4040/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
await control({reset:true});
async function browser(){
  const login=await fetch(base+'/api/login',{method:'POST',body:new URLSearchParams({code:'test-code-123'}),redirect:'manual'});
  // Keep its cookie without using a browser profile.
  let cookie=login.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  return async(path,body,options={})=>{
    const headers={Cookie:cookie,Origin:base,...options.headers};
    if(body && !(body instanceof FormData))headers['Content-Type']='application/json';
    const r=await fetch(base+path,{method:body===undefined?'GET':'POST',...options,headers,...(body===undefined?{}:{body:body instanceof FormData?body:JSON.stringify(body)})});
    const added=r.headers.getSetCookie().map(c=>c.split(';')[0]);if(added.length)cookie+='; '+added.join('; ');
    return r;
  };
}
const a=await browser(),b=await browser();
const cid=randomUUID();
assert.equal((await a('/api/gemini/conversations',{id:cid,title:'Integration conversation'})).status,200);
assert.equal((await b('/api/gemini/conversations/'+cid)).status,403);
assert.equal((await b('/api/gemini/conversations',{id:cid,title:'hijack'})).status,404);
const form=new FormData();form.set('conversationId',cid);form.set('file',new Blob(['original test document'],{type:'text/plain'}),'document.txt');
const upload=await a('/api/gemini/assets',form);assert.equal(upload.status,200);const asset=await upload.json();
const form2=new FormData();form2.set('conversationId',cid);form2.set('file',new Blob(['second comparison document'],{type:'text/plain'}),'second.txt');
const asset2=await (await a('/api/gemini/assets',form2)).json();
assert(asset2.id,'second attachment remains supported in the archive');
assert.equal(await (await a('/api/gemini/assets/'+asset.id)).text(),'original test document');
assert.equal((await b('/api/gemini/assets/'+asset.id)).status,404);
// An old client/key cannot activate any retired paid model.
const input={id:randomUUID(),conversationId:cid,modelKey:'pro',text:'hello',assets:[]};
for(const modelKey of ['pro','flash','image','image-pro','video']){
 assert.equal((await a('/api/gemini/turns',{...input,id:randomUUID(),modelKey,confirmed:true})).status,400);
}
const config=await(await a('/api/gemini/config')).json();
assert.equal(config.available,false,'offline worker must not fall back to API');
assert.deepEqual(config.models,[]);
const legacy=[];
for(const [modelKey,status] of [['video','running'],['pro','starting'],['image','completed']]){
 const id=randomUUID();legacy.push(id);await control({legacy:{id,conversationId:cid,modelKey,status}});
}
assert.equal((await b('/api/gemini/turns/'+legacy[0],{})).status,404);
assert.equal((await a('/api/gemini/turns/'+legacy[0],{})).status,200);
assert.equal((await fetch(base+'/api/cron/archive',{headers:{Authorization:'Bearer cron-test'}})).status,200);
const transcript=await(await a('/api/gemini/conversations/'+cid)).json();
assert.deepEqual(transcript.turns.map(t=>t.status),['failed','failed','completed']);
assert.deepEqual(transcript.turns.at(-1).output,[{type:'text',text:'saved answer'}]);
assert(transcript.turns.every(t=>t.provider_id===null&&t.error===null),'no added development messages');
const counts=await(await fetch('http://localhost:4040/control')).json();
assert.equal(counts.calls,0,'no provider submission');assert.equal(counts.providerReads,0,'no provider polling');
const range=await a('/api/gemini/assets/'+asset.id,undefined,{headers:{Range:'bytes=0-7'}});assert.equal(range.status,206);assert.equal(await range.text(),'original');
assert.equal((await a('/api/gemini/conversations',{id:randomUUID(),title:'CSRF'},{headers:{Origin:'https://other.invalid'}})).status,403);
assert.equal((await fetch(base+'/api/cron/archive')).status,401);
const large=randomUUID();await a('/api/gemini/conversations',{id:large,title:'Long conversation'});await control({seed:large});
const long=await (await a('/api/gemini/conversations/'+large)).json();assert.equal(long.turns.length,1001,'all pages returned');assert.equal(long.turns.at(-1).input,'page 1000');
const adminLogin=await fetch(base+'/api/admin/login',{method:'POST',body:new URLSearchParams({code:'admin-test',next:'/admin/archive'}),redirect:'manual'});
assert(adminLogin.headers.get('location').endsWith('/admin/archive'));
const adminCookie=adminLogin.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
assert.equal((await fetch(base+'/api/gemini/assets/'+asset.id,{headers:{Cookie:adminCookie}})).status,200,'admin asset access without shared site login');
const ownerPage=await(await fetch(base+'/admin/archive?id='+cid,{headers:{Cookie:adminCookie}})).text();assert(ownerPage.includes('Integration conversation'));
const deletePath='/api/admin/archive/delete';
const remove=(id,headers={})=>fetch(base+deletePath,{method:'POST',headers:{Cookie:adminCookie,Origin:base,'Content-Type':'application/json',...headers},body:JSON.stringify({id})});
assert.equal((await a(deletePath,{id:cid})).status,403,'ordinary browser cannot delete archive');
assert.equal((await remove(cid,{Origin:'https://other.invalid'})).status,403);
assert.equal((await remove('invalid')).status,400);
await control({failDelete:true});
assert.equal((await remove(cid)).status,200,'private cleanup is queued when object removal fails');
assert.equal((await a('/api/gemini/conversations/'+cid)).status,404);
assert.equal((await fetch(base+'/api/gemini/assets/'+asset.id,{headers:{Cookie:adminCookie}})).status,404);
let cleanup=await(await fetch('http://localhost:4040/control')).json();assert(cleanup.deletions>0);assert(cleanup.files>0);
await control({failDelete:false});
await fetch(base+'/api/cron/archive',{headers:{Authorization:'Bearer cron-test'}});
cleanup=await(await fetch('http://localhost:4040/control')).json();assert.equal(cleanup.deletions,0);assert.equal(cleanup.files,0);
assert.equal((await remove(cid)).status,200,'repeat deletion is safe');
assert.equal((await a('/api/gemini/conversations',{id:cid,title:'recreate'})).status,409,'deleted IDs cannot be recreated');
console.log('PASS: API disabled, legacy polling retired, archive preserved, device isolation and deletion');
