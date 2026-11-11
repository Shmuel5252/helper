import {test} from 'node:test';
import assert from 'node:assert/strict';
import {waitForMediaComposer} from '../scripts/gemini-worker/composer.mjs';

test('video chip alone does not authorize sending before the video workspace loads',async()=>{
  let release;const loaded=new Promise(resolve=>{release=resolve;});
  const events=[];
  const page={getByRole:(_,{name})=>({waitFor:async()=>{if(name.test('ביטול הבחירה של סרטונים'))events.push('chip');else{events.push('workspace');await loaded;events.push('settings');}}})};
  let ready=false;
  const pending=waitForMediaComposer(page,'video').then(()=>{ready=true;});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(ready,false);
  assert(events.includes('workspace'));
  release();await pending;
  assert.equal(ready,true);
  assert(events.includes('settings'));
});

test('unavailable video workspace fails before a request can be sent',async()=>{
  const page={getByRole:(_,{name})=>({waitFor:async()=>{if(name.test('יחס גובה-רוחב'))throw Error('workspace-not-ready');}})};
  await assert.rejects(waitForMediaComposer(page,'video'),/workspace-not-ready/);
});

test('image composer does not wait for video-only controls',async()=>{
  const page={getByRole:()=>({waitFor:async()=>{}}),getByText:()=>{throw Error('must not wait for video');}};
  await waitForMediaComposer(page,'image');
});

test('video readiness labels tolerate Hebrew direction marks',async()=>{
  const page={getByRole:(_,{name})=>({waitFor:async()=>{
    assert(['\u202bביטול הבחירה של סרטונים\u202c','\u202bיחס גובה-רוחב, לרוחב (16:9)\u202c'].some(label=>name.test(label)));
  }})};
  await waitForMediaComposer(page,'video');
});
