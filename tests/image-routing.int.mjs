// Real HTTP routes with a synthetic local queue; never contacts an image provider.
// Start with: TEST_IMAGE_AI=1 node tests/start-image-test-app.mjs
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
const base=process.env.BASE_URL||'http://127.0.0.1:3126';
const workerSecret='local-image-test-worker-secret-123456789';
let plannerCalls=0;
let translationCalls=0,translationResult='A portrait of a man in a blue shirt',translationFailure=false;
const translationInputs=[];
const planner=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  const body=JSON.parse(raw);
  assert.equal(body.model,'mock-image-planner');
  if(body.response_format?.type==='json_object'){
    translationCalls++;
    assert.equal(body.tools,undefined,'translation must not invoke the image planner');
    assert.equal(body.temperature,0);
    assert.equal(body.messages.length,2,'translation must not include previous image context');
    assert.match(body.messages[0].content,/translate/i);
    translationInputs.push(body.messages[1].content);
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({choices:[{finish_reason:translationFailure?'length':'stop',message:{role:'assistant',content:JSON.stringify({prompt:translationResult})}}]}));
    return;
  }
  plannerCalls++;
  assert.equal(body.tool_choice.function.name,'generate_image');
  res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify({choices:[{message:{role:'assistant',tool_calls:[{id:'test',type:'function',function:{name:'generate_image',arguments:JSON.stringify({prompt:'A portrait of an adult man, detailed face, sharp eyes, natural skin texture, photorealistic',seed:42})}}]}}]}));
});
await new Promise(r=>planner.listen(4018,'127.0.0.1',r));
let cookie='';
async function request(path,body,headers={}){
  const r=await fetch(base+path,{redirect:'manual',headers:{Cookie:cookie,...(body?{'Content-Type':'application/json'}:{}),...headers},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
  for(const value of r.headers.getSetCookie())cookie+=(cookie?'; ':'')+value.split(';')[0];
  return r;
}
try{
  await request('/?k=image-test-code');
  const config=await request('/api/images/config');
  assert.equal(config.status,200,'image config route must exist');
  assert.equal((await config.json()).enabled,true);
  const worker=body=>fetch(base+'/api/worker/images',{method:'POST',headers:{Authorization:'Bearer '+workerSecret,'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await worker({action:'heartbeat',state:'ready'})).status,200,'worker authenticates independently of browser cookies');
  assert.equal((await fetch(base+'/api/worker/images',{method:'POST',body:'{}'})).status,401);
  const quality='detailed face, sharp eyes, natural skin texture, photorealistic, high quality';
  for(const sample of [
    {text:'  בית ליד הים\n  ',settings:{promptMode:'direct'},expected:'  בית ליד הים\n  '},
    {text:'  A woman in blue  ',settings:{promptMode:'direct'},expected:'  A woman in blue  , '+quality},
    {text:'אל תשתמש בטקסט הזה',settings:{prompt:'  אישה בחולצה כחולה  '},expected:'  אישה בחולצה כחולה  , '+quality},
    {text:'ignored',settings:{prompt:'A red house',promptMode:'ai'},expected:'A red house'},
  ]) {
    const direct={id:crypto.randomUUID(),text:sample.text,settings:{...sample.settings,seed:123,steps:10}};
    const response=await request('/api/images/jobs',direct);
    assert.equal(response.status,200);
    const result=await response.json();
    assert.equal(result.settings.prompt,sample.expected);
    assert.equal(result.originalRequest,sample.text);
    assert.equal(result.settings.promptMode,'direct');
    assert.equal(result.settings.seed,123);assert.equal(result.settings.steps,10);
    assert.equal(plannerCalls,0,'direct requests must never call the LLM, even when AI planning is enabled');
    assert.equal((await request('/api/images/jobs',direct)).status,200);
    assert.equal((await request('/api/images/jobs',{...direct,settings:{...direct.settings,promptMode:'ai',prompt:undefined}})).status,409);
    const queued=(await (await worker({action:'claim'})).json()).job;
    assert.equal(queued.id,direct.id);assert.equal(queued.settings.prompt,sample.expected);
    assert.equal((await worker({action:'fail',id:queued.id,token:queued.token})).status,200);
  }
  for(const settings of [{promptMode:'unknown'},{prompt:42},{promptMode:'direct',prompt:'x'.repeat(2001)}]) {
    assert.equal((await request('/api/images/jobs',{id:crypto.randomUUID(),text:'test',settings})).status,400);
  }
  assert.equal(plannerCalls,0);
  const input={id:crypto.randomUUID(),text:'צור דיוקן של גבר בוגר',settings:{steps:12}};
  const created=await request('/api/images/jobs',input);
  assert.equal(created.status,200);
  const job=await created.json();
  assert.equal(job.status,'pending');assert.equal(job.settings.steps,12);
  assert.match(job.settings.prompt,/detailed face/);
  assert.equal((await request('/api/images/jobs',input)).status,200);
  assert.equal(plannerCalls,1,'retrying the same request must not plan or enqueue another image');
  assert.equal((await request('/api/images/jobs/'+input.id)).status,200);
  const other=await fetch(base+'/api/images/jobs/'+input.id,{headers:{Cookie:cookie.split('; ').filter(c=>!c.startsWith('ai_chat_device=')).join('; ')}});
  assert.equal(other.status,403,'another browser cannot read the private job');
  assert.equal((await request('/api/images/jobs',{...input,id:crypto.randomUUID()},{Origin:'https://foreign.invalid'})).status,403);
  const claim=await worker({action:'claim'});assert.equal(claim.status,200);
  const claimed=(await claim.json()).job;assert.equal(claimed.id,input.id);
  assert.equal((await worker({action:'fail',id:claimed.id,token:claimed.token})).status,200);
  assert.equal((await (await request('/api/images/jobs/'+input.id)).json()).status,'failed');
  for(const sample of [
    {text:'דיוקן של גבר בחולצה כחולה',settings:{},translated:'A portrait of a man in a blue shirt',expected:'A portrait of a man in a blue shirt, '+quality,calls:1},
    {text:'ignored',settings:{prompt:'בית אדום ליד הים'},translated:'A red house by the sea',expected:'A red house by the sea',calls:2},
    {text:'A red house',settings:{},translated:'unused',expected:'A red house',calls:2},
  ]){
    translationResult=sample.translated;
    const translated={id:crypto.randomUUID(),text:sample.text,settings:{...sample.settings,promptMode:'translate',seed:123,steps:10}};
    const response=await request('/api/images/jobs',translated);
    assert.equal(response.status,200,await response.clone().text());
    const result=await response.json();
    assert.equal(result.settings.prompt,sample.expected);
    assert.equal(result.originalRequest,sample.text);
    assert.equal(result.settings.promptMode,'translate');
    assert.equal(result.settings.steps,10);assert.equal(result.settings.seed,123);
    assert.equal(translationCalls,sample.calls);assert.equal(plannerCalls,1);
    assert.equal((await request('/api/images/jobs',translated)).status,200);
    assert.equal(translationCalls,sample.calls,'retry must not translate again');
    const queued=(await (await worker({action:'claim'})).json()).job;
    assert.equal(queued.id,translated.id);assert.equal(queued.settings.prompt,sample.expected);
    assert.equal((await worker({action:'fail',id:queued.id,token:queued.token})).status,200);
  }
  assert.deepEqual(translationInputs,['דיוקן של גבר בחולצה כחולה','בית אדום ליד הים']);
  for(const bad of ['', 'עדיין בעברית', 'x'.repeat(2001)]){
    translationResult=bad;
    const response=await request('/api/images/jobs',{id:crypto.randomUUID(),text:'דיוקן של גבר',settings:{promptMode:'translate'}});
    assert.equal(response.status,502,'invalid translation must fail rather than silently change or enqueue text');
  }
  translationResult='A man';translationFailure=true;
  assert.equal((await request('/api/images/jobs',{id:crypto.randomUUID(),text:'גבר',settings:{promptMode:'translate'}})).status,502);
  assert.equal((await (await worker({action:'claim'})).json()).job,null);
  assert.equal(plannerCalls,1,'translation errors must not fall back to AI planning');
  console.log('PASS translation-only routing, source fidelity, face suffix, English passthrough, retries and invalid-output handling');
  console.log('PASS direct Hebrew/English with zero LLM calls, advanced prompt override, validation, idempotency, worker payload, private polling and default AI planning');
}finally{planner.close();}
