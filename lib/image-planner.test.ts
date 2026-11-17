import test from 'node:test';
import assert from 'node:assert/strict';
import {APIConnectionError,APIConnectionTimeoutError} from 'openai';
import type {ModelEntry} from './models.ts';
import {requestAutomaticImagePlan} from './image-planner.ts';

const entry=(key:string,model:string,effort:ModelEntry['effort']='none'):ModelEntry=>({key,model,effort,label:key,description:'',vision:true});
const models=[entry('fast','model-one'),entry('deep','model-one','medium'),entry('alt','model-two'),entry('last','model-three')];
const providerError=(status:number)=>Object.assign(new Error('private provider body'),{status});

test('automatic planning consistently starts with the configured default and preserves its settings',async()=>{
  const before=structuredClone(models);
  for(let i=0;i<2;i++){
    const calls:{model:ModelEntry;timeout:number}[]=[];
    const result=await requestAutomaticImagePlan(models,async(model,timeout)=>{calls.push({model,timeout});return {prompt:'car engine'};});
    assert.deepEqual(result,{prompt:'car engine'});
    assert.equal(calls.length,1);
    assert.equal(calls[0].model,models[0]);
    assert.ok(calls[0].timeout>0&&calls[0].timeout<=20_000);
  }
  assert.deepEqual(models,before);
});

test('temporary provider failures retry once using the first distinct underlying model',async()=>{
  for(const failure of [providerError(408),providerError(429),providerError(500),providerError(502),providerError(503),providerError(504),new APIConnectionError({}),new APIConnectionTimeoutError()]){
    const calls:{key:string;timeout:number}[]=[];
    const events:unknown[]=[];
    const result=await requestAutomaticImagePlan(models,async(model,timeout)=>{
      calls.push({key:model.key,timeout});
      if(calls.length===1)throw failure;
      return 'planned';
    },info=>events.push(info));
    assert.equal(result,'planned');
    assert.deepEqual(calls.map(call=>call.key),['fast','alt']);
    assert.ok(calls[1].timeout>0&&calls[1].timeout<=25_000);
    assert.equal(events.length,1);
    assert.equal((events[0] as {willRetry:boolean}).willRetry,true);
  }
});

test('a failed alternate is final even when more configured models exist',async()=>{
  const first=providerError(503),second=providerError(429);
  const calls:string[]=[];const retries:boolean[]=[];
  await assert.rejects(requestAutomaticImagePlan(models,async model=>{
    calls.push(model.key);throw calls.length===1?first:second;
  },info=>retries.push(info.willRetry)),error=>error===second);
  assert.deepEqual(calls,['fast','alt']);
  assert.deepEqual(retries,[true,false]);
});

test('same-model aliases are not retried when no distinct model is configured',async()=>{
  let calls=0;const failure=providerError(503);const retries:boolean[]=[];
  await assert.rejects(requestAutomaticImagePlan(models.slice(0,2),async()=>{calls++;throw failure;},info=>retries.push(info.willRetry)),error=>error===failure);
  assert.equal(calls,1);assert.deepEqual(retries,[false]);
});

test('authentication, invalid requests, refusals and malformed results do not select another model',async()=>{
  for(const failure of [providerError(400),providerError(401),providerError(403),providerError(404),providerError(422),new Error('Refusal'),new Error('Missing tool'),new SyntaxError('Invalid JSON')]){
    let calls=0;
    await assert.rejects(requestAutomaticImagePlan(models,async()=>{calls++;throw failure;}),error=>error===failure);
    assert.equal(calls,1);
  }
  // Response validation belongs to the caller, after the request helper returns.
  for(const result of [{refusal:'refused'},{tool_calls:[]},{arguments:'not JSON'}]){
    let calls=0;
    assert.equal(await requestAutomaticImagePlan(models,async()=>{calls++;return result;}),result);
    assert.equal(calls,1);
  }
});

test('the alternate receives only the time remaining in the overall 45-second budget',async t=>{
  let now=100_000;
  t.mock.method(Date,'now',()=>now);
  const timeouts:number[]=[];
  await requestAutomaticImagePlan(models,async(_model,timeout)=>{
    timeouts.push(timeout);
    if(timeouts.length===1){now+=32_000;throw providerError(503);}
    return 'planned';
  });
  assert.deepEqual(timeouts,[20_000,13_000]);
});

test('an exhausted total budget preserves the first failure without starting an alternate',async t=>{
  let now=100_000;
  t.mock.method(Date,'now',()=>now);
  const failure=providerError(503);let calls=0;const retries:boolean[]=[];
  await assert.rejects(requestAutomaticImagePlan(models,async()=>{
    calls++;now+=45_000;throw failure;
  },info=>retries.push(info.willRetry)),error=>error===failure);
  assert.equal(calls,1);assert.deepEqual(retries,[false]);
});

test('diagnostics contain only option key, numeric status, safe error name and retry decision',async()=>{
  const failure=Object.assign(providerError(503),{name:'Contains private text /token=secret',requestID:'private',code:'private',cause:new Error('private')});
  const events:unknown[]=[];
  await assert.rejects(requestAutomaticImagePlan(models.slice(0,1),async()=>{throw failure;},info=>events.push(info)));
  assert.deepEqual(events,[{modelKey:'fast',status:503,error:'Unknown',willRetry:false}]);
  assert.equal(JSON.stringify(events).includes('private'),false);
});

test('missing model configuration fails before making any request',async()=>{
  let calls=0;
  await assert.rejects(requestAutomaticImagePlan([],async()=>{calls++;return 'unexpected';}));
  assert.equal(calls,0);
});
