import {test} from 'node:test';
import assert from 'node:assert/strict';
import {watchUpdates} from './gemini-polling.ts';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
test('returning to chat refreshes immediately, coalesces events and stops after cleanup',async()=>{
 const win=new EventTarget();const doc=Object.assign(new EventTarget(),{visibilityState:'visible'});
 let calls=0;let release=()=>{};
 const stop=watchUpdates(async()=>{calls++;await new Promise<void>(r=>{release=r;});},win,doc);
 assert.equal(calls,1);
 win.dispatchEvent(new Event('focus'));doc.dispatchEvent(new Event('visibilitychange'));
 assert.equal(calls,1);release();await tick();assert.equal(calls,2);
 release();await tick();doc.visibilityState='hidden';doc.dispatchEvent(new Event('visibilitychange'));assert.equal(calls,2);
 doc.visibilityState='visible';doc.dispatchEvent(new Event('visibilitychange'));assert.equal(calls,3);
 stop();release();await tick();win.dispatchEvent(new Event('focus'));assert.equal(calls,3);
});
