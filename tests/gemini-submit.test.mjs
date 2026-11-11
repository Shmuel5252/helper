import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as media from '../scripts/gemini-worker/composer.mjs';
const {waitForMediaComposer,submitMedia}=media;

function composer({missingChip=false,missingAspect=false}={}){
  const events=[];
  return {events,page:{
    getByText(){throw Error('strict mode: history titles also contain יצירת סרטונים');},
    getByRole(role,{name}){
      assert.equal(role,'button');
      if(name.test('ביטול הבחירה של סרטונים')||name.test('ביטול הבחירה של תמונות'))return {waitFor:async()=>{events.push('chip');if(missingChip)throw Error('tool-not-selected');}};
      if(name.test('יחס גובה-רוחב, לאורך (9:16)'))return {waitFor:async()=>{events.push('aspect');if(missingAspect)throw Error('video-workspace-not-ready');}};
      if(name.test('שליחת הודעה'))return {click:async()=>events.push('send-click')};
      throw Error('unexpected control');
    },
  }};
}
test('video readiness uses controls, never ambiguous conversation titles',async()=>{
  const {page,events}=composer();await waitForMediaComposer(page,'video');assert.deepEqual(events,['chip','aspect']);
});
test('the video chip without the video workspace is insufficient',async()=>{
  const {page}=composer({missingAspect:true});await assert.rejects(waitForMediaComposer(page,'video'),/video-workspace-not-ready/);
});
test('image readiness does not require video controls',async()=>{
  const {page,events}=composer();await waitForMediaComposer(page,'image');assert.deepEqual(events,['chip']);
});
test('submit rechecks the tool after uploads and clicks the send control',async()=>{
  const {page,events}=composer();await submitMedia(page,'video');assert.deepEqual(events,['chip','aspect','send-click']);
});
test('if an upload or edit loses video mode, no normal chat request is sent',async()=>{
  const {page,events}=composer({missingChip:true});await assert.rejects(submitMedia(page,'video'),/tool-not-selected/);assert(!events.includes('send-click'));
});
