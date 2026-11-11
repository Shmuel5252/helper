import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WorkerLease} from '../scripts/gemini-worker/lease.mjs';
test('temporary heartbeat/renew transport failure does not revoke an unexpired claim',()=>{
 let now=1000;const lease=new WorkerLease(91000,()=>now);
 lease.failed(503);now=60000;assert.doesNotThrow(()=>lease.check());
 lease.renewed(60000);now=140000;assert.doesNotThrow(()=>lease.check());
 now=145001;assert.throws(()=>lease.check());
});
test('server fencing immediately stops work even before local expiry',()=>{
 for(const status of [401,409]){const lease=new WorkerLease(90000,()=>1000);lease.failed(status);assert.throws(()=>lease.check());}
});
