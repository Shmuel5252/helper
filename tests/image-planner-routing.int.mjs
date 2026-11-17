// Real local routes and queue; all language-model requests terminate at this synthetic server.
// Start a fresh test app with TEST_IMAGE_AI=1, a fresh TEST_IMAGE_DATA directory, and
// TEST_IMAGE_MODELS=fast|mock-fast|Fast||none|1,deep|mock-fast|Deep||medium|1,alt|mock-alt|Alt||off|1
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';

const base=new URL(process.env.BASE_URL||'http://127.0.0.1:3126');
assert.ok(base.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(base.hostname),'Only a synthetic local test app is permitted');
const calls=[];
let scenario='success';
const planned={prompt:'A red cottage beside a still lake, clear morning light',negative_prompt:'blurry, watermark',steps:28,guidance_scale:6,width:512,height:512,seed:2468};
const manual={steps:12,guidance_scale:7,width:320,height:384,seed:13579};
const expected={...planned,...manual};
const translatedPrompt='A red house by a lake';
const planner=createServer(async(request,response)=>{
  try{
    assert.equal(request.method,'POST');
    assert.equal(request.url,'/v1/chat/completions');
    let raw='';for await(const chunk of request)raw+=chunk;
    const body=JSON.parse(raw);calls.push(body);
    response.setHeader('Content-Type','application/json');
    if(scenario==='400'||scenario==='503'&&body.model==='mock-fast'){
      response.statusCode=Number(scenario);
      response.end(JSON.stringify({error:{message:'Synthetic provider failure',type:'test_error'}}));return;
    }
    if(body.response_format?.type==='json_object'){
      response.end(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({prompt:translatedPrompt})}}]}));return;
    }
    const tool={id:'synthetic-tool',type:'function',function:{name:'generate_image',arguments:scenario==='bad-json'?'{invalid':JSON.stringify(planned)}};
    const message={role:'assistant',tool_calls:scenario==='missing-tool'?[]:[tool],...(scenario==='refusal'?{refusal:'Synthetic refusal'}:{})};
    response.end(JSON.stringify({choices:[{finish_reason:'stop',message}]}));
  }catch(error){response.writeHead(500,{'Content-Type':'application/json'});response.end(JSON.stringify({error:{message:String(error)}}));}
});
await new Promise((resolve,reject)=>{planner.once('error',reject);planner.listen(4018,'127.0.0.1',resolve);});

const cookies=new Map();
async function request(path,body){
  const response=await fetch(new URL(path,base),{redirect:'manual',signal:AbortSignal.timeout(60000),headers:{Cookie:[...cookies].map(([key,value])=>`${key}=${value}`).join('; '),...(body?{'Content-Type':'application/json'}:{})},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
  for(const value of response.headers.getSetCookie()){
    const pair=value.split(';')[0],split=pair.indexOf('=');cookies.set(pair.slice(0,split),pair.slice(split+1));
  }
  return response;
}
async function json(response,status=200){assert.equal(response.status,status,await response.clone().text());return response.json();}
async function worker(body){
  return json(await fetch(new URL('/api/worker/images',base),{method:'POST',headers:{Authorization:'Bearer local-image-test-worker-secret-123456789','Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)}));
}
async function queueEmpty(){assert.equal((await worker({action:'claim'})).job,null,'An unexpected image was enqueued');}
async function finishJob(input,settings){
  const persisted=await json(await request('/api/images/jobs/'+input.id));
  assert.deepEqual(persisted.settings,settings);
  assert.equal(persisted.originalRequest,input.text);
  const claimed=(await worker({action:'claim'})).job;
  assert.equal(claimed?.id,input.id,'The queue must contain exactly the submitted image');
  assert.deepEqual(claimed.settings,settings);
  await worker({action:'fail',id:claimed.id,token:claimed.token});
  await queueEmpty();
}
function requestShape(call,model,effort){
  assert.equal(call.model,model);
  assert.equal(call.reasoning_effort,effort);
  assert.equal(call.tool_choice?.function.name,'generate_image');
}

try{
  await request('/?k=image-test-code');
  const config=await json(await request('/api/images/config'));
  assert.equal(config.mode,'local');assert.equal(config.promptAI,true);
  assert.deepEqual((await json(await request('/api/models'))).models.map(model=>model.key),['fast','deep','alt'],'Start the app with the documented TEST_IMAGE_MODELS value');
  await queueEmpty();
  for(const hiddenKey of ['alt','deep']){
    const before=calls.length;
    const input={id:randomUUID(),text:'צור בית אדום ליד אגם',modelKey:hiddenKey,settings:{promptMode:'ai',...manual}};
    const result=await json(await request('/api/images/jobs',input));
    assert.deepEqual(result.settings,expected);
    assert.equal(calls.length,before+1);
    requestShape(calls.at(-1),'mock-fast','none');
    assert.equal(calls.at(-1).messages.at(-1).content,input.text);
    assert.deepEqual((await json(await request('/api/images/jobs',input))).settings,expected);
    assert.equal(calls.length,before+1,'Duplicate IDs must not plan a second image');
    await finishJob(input,expected);
  }
  console.log('PASS automatic planning ignores hidden alt/deep chat selections and preserves settings once');

  scenario='503';
  const beforeFallback=calls.length;
  const fallback={id:randomUUID(),text:'צור בית אדום ליד אגם',modelKey:'deep',settings:{promptMode:'ai',...manual}};
  assert.deepEqual((await json(await request('/api/images/jobs',fallback))).settings,expected);
  assert.equal(calls.length,beforeFallback+2,'A transient failure must use exactly one distinct alternate');
  requestShape(calls[beforeFallback],'mock-fast','none');
  requestShape(calls[beforeFallback+1],'mock-alt',undefined);
  assert.deepEqual(calls[beforeFallback].messages,calls[beforeFallback+1].messages,'Fallback must preserve the original planning instructions and input');
  assert.deepEqual((await json(await request('/api/images/jobs',fallback))).settings,expected);
  assert.equal(calls.length,beforeFallback+2,'A duplicate after fallback must not plan again');
  await finishJob(fallback,expected);
  console.log('PASS 503 falls back once to a distinct model and queues one unchanged image request');

  for(const failure of ['bad-json','missing-tool','refusal','400']){
    scenario=failure;
    const before=calls.length;
    const input={id:randomUUID(),text:'צור בית אדום ליד אגם',modelKey:'alt',settings:{promptMode:'ai'}};
    const result=await request('/api/images/jobs',input);
    assert.equal(result.status,502,`${failure}: ${await result.text()}`);
    assert.equal(calls.length,before+1,`${failure} must not try another model`);
    requestShape(calls.at(-1),'mock-fast','none');
    assert.equal((await request('/api/images/jobs/'+input.id)).status,404,`${failure} must not persist a job`);
    await queueEmpty();
  }
  console.log('PASS malformed JSON, missing tool, refusal and HTTP400 never retry or enqueue');

  scenario='success';
  const beforeTranslation=calls.length;
  const translation={id:randomUUID(),text:'בית אדום ליד אגם',modelKey:'alt',settings:{promptMode:'translate',seed:7,steps:10}};
  const translated=await json(await request('/api/images/jobs',translation));
  assert.equal(calls.length,beforeTranslation+1);
  assert.equal(calls.at(-1).model,'mock-alt');assert.equal(calls.at(-1).reasoning_effort,undefined);
  assert.equal(calls.at(-1).tools,undefined);assert.equal(calls.at(-1).response_format.type,'json_object');
  assert.equal(translated.settings.prompt,translatedPrompt);assert.equal(translated.settings.promptMode,'translate');
  await finishJob(translation,translated.settings);
  const beforeDirect=calls.length;
  const direct={id:randomUUID(),text:'  בית אדום ליד אגם  ',modelKey:'alt',settings:{promptMode:'direct',seed:7,steps:10}};
  const directed=await json(await request('/api/images/jobs',direct));
  assert.equal(directed.settings.prompt,direct.text);assert.equal(calls.length,beforeDirect,'Direct mode must never invoke a language model');
  await finishJob(direct,directed.settings);
  console.log('PASS explicit translation still honors the selected model; direct mode makes zero model calls');
}finally{
  await new Promise(resolve=>{planner.close(resolve);planner.closeAllConnections();});
}
