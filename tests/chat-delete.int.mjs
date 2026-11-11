import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const base=process.env.TEST_URL??'http://localhost:3110';
async function client(){
 const login=await fetch(base+'/api/login',{method:'POST',body:new URLSearchParams({code:'test-code-123'}),redirect:'manual'});
 let cookie=login.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
 return async(path,method='GET',body,origin=base)=>{
  const r=await fetch(base+path,{method,headers:{Cookie:cookie,Origin:origin,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});
  cookie+='; '+r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');return r;
 };
}
const a=await client(),b=await client(),id=randomUUID(),other=randomUUID();
assert.equal((await a('/api/gemini/conversations','POST',{id,title:'Disposable deletion test'})).status,200);
await b('/api/gemini/conversations','POST',{id:other,title:'Other device'});
const path='/api/gemini/conversations/'+id;
const form=new FormData();form.set('conversationId',id);form.set('file',new Blob(['deletion fixture'],{type:'text/plain'}),'test.txt');
const asset=await(await a('/api/gemini/assets','POST',form)).json();
assert.equal((await a(path,'DELETE',undefined,'https://other.invalid')).status,403,'reject cross-origin deletion');
assert.equal((await b(path,'DELETE')).status,404,'another device cannot delete this conversation');
assert.equal((await a(path)).status,200,'rejected deletes preserve conversation');
assert.equal((await a(path,'DELETE')).status,200,'owner can fully delete');
assert.equal((await a(path)).status,404);
assert.equal((await a('/api/gemini/assets/'+asset.id)).status,404,'deleted attachment is inaccessible');
assert.equal((await a('/api/gemini/conversations','POST',{id,title:'recreate'})).status,409,'cannot resurrect');
assert.equal((await b('/api/gemini/conversations/'+other)).status,200,'other device untouched');
console.log('PASS: device deletion, origin protection, ownership, attachment removal and no resurrection');
