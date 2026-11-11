import {test} from 'node:test';
import assert from 'node:assert/strict';
import {executeJob} from '../scripts/gemini-worker/lifecycle.mjs';
const job={id:'job',token:'token',kind:'image',text:'cat',inputs:[]};

test('a final refusal is delivered as text without a media upload or another submission',async()=>{
 const events=[];let attempts=0;
 const text='אני לא יכול/ה ליצור סרטונים כאלה.';
 const adapter={prepare:async()=>{},submit:async()=>events.push('send'),result:async()=>({terminalText:text})};
 await executeJob(job,{adapter,api:async(action,data)=>{events.push(action);if(action==='response'){assert.equal(data.text,text);if(attempts++===0)throw Error('network');}return {ok:true};},upload:async()=>{throw Error('must not upload');},pause:async()=>{},check:()=>{}});
 assert.deepEqual(events,['submit','send','response','response']);
});

test('explicit recovery only downloads the saved source and never generates again',async()=>{
 const events=[];
 const adapter={resume:async j=>events.push(j.source),prepare:async()=>{throw Error('must not prepare a new request');},submit:async()=>{throw Error('must not send');},result:async()=>({bytes:Buffer.from('video'),mime:'video/mp4'})};
 await executeJob({...job,source:'https://gemini.google.com/app/saved'},{adapter,api:async action=>{events.push(action);return {url:'https://storage.test/file'};},upload:async()=>events.push('upload'),check:()=>{}});
 assert.deepEqual(events,['https://gemini.google.com/app/saved','submit','reserve','upload','complete']);
});
test('intent is durable before Send and upload retries never regenerate',async()=>{
 const events=[];let completes=0;
 const api=async(action)=>{events.push(action);if(action==='reserve')return {url:'https://storage.test/file'};if(action==='complete'&&completes++===0)throw new Error('network');return {ok:true};};
 const adapter={prepare:async()=>events.push('prepare'),submit:async()=>events.push('send'),result:async()=>({bytes:Buffer.from([137,80,78,71,13,10,26,10]),mime:'image/png',source:'https://gemini.google.com/app/test'})};
 await executeJob(job,{api,adapter,upload:async()=>events.push('upload'),pause:async()=>{},check:()=>{}});
 assert(events.indexOf('submit')<events.indexOf('send'));assert.equal(events.filter(x=>x==='send').length,1);assert.equal(completes,2);
});
test('failed intent acknowledgement never clicks Send',async()=>{
 let sent=false;
 await assert.rejects(executeJob(job,{api:async()=>{throw Error('offline');},adapter:{prepare:async()=>{},submit:async()=>{sent=true;}},check:()=>{}}));
 assert.equal(sent,false);
});
test('lost lease stops before sending',async()=>{
 let sent=false;
 await assert.rejects(executeJob(job,{api:async()=>({}),adapter:{prepare:async()=>{},submit:async()=>{sent=true;}},check:()=>{throw Error('expired');}}));
 assert.equal(sent,false);
});
