import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generationPrompt} from '../scripts/gemini-worker/prompt.mjs';

const instruction='Create a video using the video generation tool. Follow the description below:\n\n';
test('Hebrew video descriptions get the verified tool instruction without changing the original input',()=>{
  const job=Object.freeze({kind:'video',text:'צור סרטון של גלים. בלי אנשים ובלי טקסט.'});
  assert.equal(generationPrompt(job),instruction+job.text);
  assert.equal(job.text,'צור סרטון של גלים. בלי אנשים ובלי טקסט.');
});
test('English video prompts and image prompts remain unchanged',()=>{
  for(const job of [{kind:'video',text:'Create a video of waves.'},{kind:'image',text:'צור תמונה של גלים.'}])assert.equal(generationPrompt(job),job.text);
});
test('the instruction is not duplicated on an already explicit video prompt',()=>{
  const text=instruction+'צור סרטון של גלים.';
  assert.equal(generationPrompt({kind:'video',text}),text);
});
test('an attachment-only video request uses an explicit English video instruction',()=>{
  assert.equal(generationPrompt({kind:'video',text:''}),'Create a video from the attached image.');
});
