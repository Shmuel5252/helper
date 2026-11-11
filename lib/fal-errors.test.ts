import test from 'node:test';
import assert from 'node:assert/strict';
import {falFailure,submitFal} from './fal.ts';

test('exhausted credit and quota show a simple failure without an automatic retry',async()=>{
  for(const status of [402,403,429]){
    const body={detail:status===429?'quota exceeded':'User is locked. Exhausted balance.'};
    const error=falFailure(status,body);
    assert.equal(error.message,'לא הצלחנו ליצור.');
    assert.equal(error.rejected,true);
    let calls=0;
    await assert.rejects(()=>submitFal('mock',{endpoint:'fal-ai/flux-2/klein/4b',input:{prompt:'boat'}},'https://test.example/hook',async()=>{
      calls++;return Response.json(body,{status});
    }),/לא הצלחנו ליצור\./);
    assert.equal(calls,1);
  }
});
