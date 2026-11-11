// Exercises the real app route against a local LLM protocol fixture. No image generation.
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
let calls=0;
const server=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);calls++;
  assert.equal(body.model,'mock-image-planner');assert.equal(body.tools[0].function.name,'generate_image');
  assert.equal(body.tool_choice.function.name,'generate_image');
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({id:'mock',object:'chat.completion',choices:[{index:0,finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:'call_1',type:'function',function:{name:'generate_image',arguments:JSON.stringify({prompt:'A ginger cat sitting beside a blue window, soft daylight, realistic photograph',steps:999,guidance_scale:30,width:1000,height:300,seed:-1})}}]}}]}));
});await new Promise(r=>server.listen(4018,'127.0.0.1',r));
const browser=await chromium.launch();
try{
 const context=await browser.newContext();await context.request.get('http://127.0.0.1:3126/?k=image-test-code');
 const post=data=>context.request.post('http://127.0.0.1:3126/api/images/jobs',{data});
 const first={id:crypto.randomUUID(),text:'צור לי תמונה של חתול ליד חלון',settings:{steps:12,guidance_scale:4,seed:42}};
 const r=await post(first);assert.equal(r.status(),200);const j=await r.json();
 assert.equal(j.settings.steps,12);assert.equal(j.settings.guidance_scale,4);assert.equal(j.settings.seed,42);assert.equal(j.settings.width,512);assert.equal(j.settings.height,320);assert.match(j.settings.prompt,/ginger cat/);
 assert.equal((await post(first)).status(),200);assert.equal(calls,1);
 const second=await post({id:crypto.randomUUID(),text:'השתמש באותו Seed',previousJobId:first.id,reuseSeed:true});assert.equal(second.status(),200);assert.equal((await second.json()).settings.seed,42);
 const third=await post({id:crypto.randomUUID(),text:'צור גרסה נוספת',previousJobId:first.id});assert.equal(third.status(),200);assert.notEqual((await third.json()).settings.seed,42);
 assert.equal((await post({id:crypto.randomUUID(),text:'צור לי תמונה של עץ'})).status(),429);
 console.log('PASS real generate_image tool route, Hebrew intent, same selected LLM, bounded AI settings, manual precedence, same-seed/variant and no repeated planning for retry');
}finally{await browser.close();server.close();}
