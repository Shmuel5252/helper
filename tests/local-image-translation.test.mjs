import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareImageSettings} from '../scripts/image-worker/local-translation.mjs';

const quality='detailed face, sharp eyes, natural skin texture, photorealistic, high quality';
test('local Hebrew translation appends only face tokens and preserves manual settings',async()=>{
  let calls=0;
  const result=await prepareImageSettings({prompt:'גבר בחולצה כחולה',promptMode:'local-translate',seed:7,steps:12},async text=>{
    calls++;assert.equal(text,'גבר בחולצה כחולה');return 'A man in a blue shirt';
  });
  assert.equal(calls,1);assert.equal(result.prompt,'A man in a blue shirt, '+quality);
  assert.equal(result.seed,7);assert.equal(result.steps,12);assert.equal(result.promptMode,'local-translate');
});
test('non-person translation and English passthrough add no content',async()=>{
  const result=await prepareImageSettings({prompt:'בית אדום',promptMode:'local-translate',seed:7},async()=> 'A red house');
  assert.equal(result.prompt,'A red house');
  const english=await prepareImageSettings({prompt:'  A red house  ',promptMode:'local-translate',seed:7},async()=>{throw Error('must not translate English');});
  assert.equal(english.prompt,'  A red house  ');
});
test('direct, cloud-translated and AI prompts never call the local translator',async()=>{
  for(const promptMode of ['direct','translate','ai']){
    const result=await prepareImageSettings({prompt:'אדם',promptMode,seed:7},async()=>{throw Error('must not translate');});
    assert.equal(result.prompt,'אדם');
  }
});
test('failed, incomplete or excessive translations stop before image generation',async()=>{
  const input={prompt:'אדם',promptMode:'local-translate'};
  for(const result of ['', 'עדיין בעברית', 'x'.repeat(2001)])await assert.rejects(()=>prepareImageSettings(input,async()=>result));
  await assert.rejects(()=>prepareImageSettings(input,async()=>{throw Error('offline model missing');}),/offline model missing/);
});
