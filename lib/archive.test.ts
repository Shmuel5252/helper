import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARCHIVE_MODELS, parseTurn, modelFor, uuid } from './archive/validation.ts';
const id='12345678-1234-4234-8234-123456789abc';
test('only declared account/fal media keys are accepted; old paid Google API keys stay rejected',()=>{
  assert.deepEqual(ARCHIVE_MODELS.map(m=>m.key),['account-image','account-video','fal-image-v1','fal-video-v1']);
  for(const modelKey of ['account-image','account-video']){
    assert.equal(modelFor(modelKey)?.provider,'account');
    assert.equal(parseTurn({id,conversationId:id,modelKey,text:'cat',assets:[]}).modelKey,modelKey);
  }
  for(const modelKey of ['fal-image-v1','fal-video-v1']){
    assert.equal(modelFor(modelKey)?.provider,'fal');
    assert.equal(parseTurn({id,conversationId:id,modelKey,text:'cat',assets:[]}).modelKey,modelKey);
  }
  for(const modelKey of ['pro','flash','image','image-pro','video','gemini-4-argon','unknown']){
    assert.equal(modelFor(modelKey),undefined);
    assert.throws(()=>parseTurn({id,conversationId:id,modelKey,text:'cat',assets:[],confirmed:true}));
  }
});
test('account turn validation enforces UUIDs, input limits and valid attachments',()=>{
  const input={id,conversationId:id,modelKey:'account-image',text:' שלום ',assets:[]};
  assert.equal(uuid('../secret'),false);
  assert.equal(parseTurn(input).text,'שלום');
  for(const patch of [{id:'x'},{conversationId:'x'},{text:'x'.repeat(4001)},{text:' '},{assets:[id,id]},{assets:['../secret']}])assert.throws(()=>parseTurn({...input,...patch}));
  assert.deepEqual(parseTurn({...input,text:'',assets:[id]}).assets,[id]);
});
