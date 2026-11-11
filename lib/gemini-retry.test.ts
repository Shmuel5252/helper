import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildRetry} from './gemini-retry.ts';
import type {ArchiveTurn,ArchiveAsset} from './archive/types.ts';
const turn={id:'old',conversation_id:'conversation',model_key:'account-video',input:'original request',assets:['image'],status:'uncertain'} as ArchiveTurn;
const assets=[{id:'image',conversation_id:'conversation',mime:'image/png'}] as ArchiveAsset[];
test('explicit retry preserves the original text, model and files under a new ID',()=>{
  const before=JSON.stringify(turn);
  const attempt=buildRetry(turn,assets,null,()=> 'new');
  assert.deepEqual(attempt,{sourceId:'old',input:{id:'new',conversationId:'conversation',modelKey:'account-video',text:'original request',assets:['image']}});
  assert.equal(JSON.stringify(turn),before);
  assert.notEqual(attempt.input.assets,turn.assets);
});
test('retrying after a lost acknowledgement uses the same request ID',()=>{
  const first=buildRetry(turn,assets,null,()=> 'new');
  assert.deepEqual(buildRetry(turn,assets,first,()=>{throw Error('must not generate twice');}),first);
});
test('pending, completed, legacy or missing-file requests cannot be retried',()=>{
  for(const status of ['running','starting','completed'] as const)assert.throws(()=>buildRetry({...turn,status},assets));
  assert.throws(()=>buildRetry({...turn,model_key:'video'},assets));
  assert.throws(()=>buildRetry(turn,[]));
  assert.throws(()=>buildRetry(turn,[{...assets[0],conversation_id:'other'}]));
  assert.throws(()=>buildRetry(turn,assets,null,()=>turn.id));
});
