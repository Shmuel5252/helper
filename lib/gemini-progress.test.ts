import {test} from 'node:test';
import assert from 'node:assert/strict';
import {progressState, requestJson, RequestError} from './gemini-progress.ts';

test('connection changes retain the last confirmed stage rather than flickering',()=>{
  for(const status of ['starting','running'] as const){
    assert.equal(progressState(status,false,1000,2000),status==='starting'?'queued':'processing');
    assert.equal(progressState(status,true,0,2000),'waiting');
    assert.equal(progressState(status,true,1000,17000),status==='starting'?'queued':'processing');
  }
  assert.equal(progressState('starting',true,1000,2000),'queued');
  assert.equal(progressState('running',true,1000,2000),'processing');
});
test('terminal state wins even when the connection is lost',()=>{
  assert.equal(progressState('completed',false,0,20000),null);
  assert.equal(progressState('failed',false,0,20000),'stopped');
  assert.equal(progressState('uncertain',true,19000,20000),'uncertain');
});
test('transport failure is readable and never retried automatically',async()=>{
  let calls=0;
  await assert.rejects(requestJson('/test',{method:'POST'},async()=>{calls++;throw new TypeError('Failed to fetch');}),/החיבור/);
  assert.equal(calls,1);
});
test('HTTP status is preserved; malformed success is not a fresh update',async()=>{
  await assert.rejects(requestJson('/test',{},async()=>new Response('{"error":"missing"}',{status:404})),e=>e instanceof RequestError&&e.status===404);
  await assert.rejects(requestJson('/test',{},async()=>new Response('<html>bad response</html>')),/עדכון/);
  assert.deepEqual(await requestJson('/test',{},async()=>Response.json({status:'completed'})),{status:'completed'});
});
