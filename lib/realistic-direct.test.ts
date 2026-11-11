import test from 'node:test';
import assert from 'node:assert/strict';
import {directImagePrompt, normalizeSettings, usesDirectImagePrompt} from './realistic-image.ts';

const quality='detailed face, sharp eyes, natural skin texture, photorealistic, high quality';
test('direct text preserves English, Hebrew, whitespace and punctuation without expansion',()=>{
  for(const text of ['  A red house.\nKeep EXACTLY this!  ','  בית אדום ליד הים\nללא שינוי  ']) {
    assert.equal(directImagePrompt(text),text);
    assert.equal(normalizeSettings({prompt:text,promptMode:'direct',seed:42}).prompt,text);
  }
});
test('person mentions append only the existing quality tokens in either language',()=>{
  for(const text of ['A woman in a blue shirt','  גבר בחולצה כחולה  ','תמונה של האישה ליד החלון','אדם עם כלב','A HUMAN with a dog']) {
    assert.equal(directImagePrompt(text),text+', '+quality);
  }
  assert.equal(directImagePrompt('A woman, detailed face, sharp eyes'), 'A woman, detailed face, sharp eyes, natural skin texture, photorealistic, high quality');
  assert.equal(directImagePrompt('A man, '+quality),'A man, '+quality);
});
test('person matching does not match unrelated substrings',()=>{
  for(const text of ['a snowman and a womanizer','a humanless landscape','בית על אדמה ליד אישון של חתול'])assert.equal(directImagePrompt(text),text);
});
test('direct mode rejects empty or overlong prompts instead of changing them',()=>{
  assert.throws(()=>directImagePrompt(' \n '));
  assert.equal(normalizeSettings({prompt:'x'.repeat(2000),promptMode:'direct',seed:42}).prompt.length,2000);
  assert.throws(()=>normalizeSettings({prompt:'x'.repeat(2001),promptMode:'direct'}));
  assert.throws(()=>normalizeSettings({prompt:directImagePrompt('A man '+ 'x'.repeat(1990)),promptMode:'direct'}));
});
test('direct prompts survive worker normalization; legacy normalization stays unchanged',()=>{
  const settings=normalizeSettings({prompt:'  אישה\n  ',promptMode:'direct',seed:7});
  assert.deepEqual(normalizeSettings(settings),settings);
  assert.equal(normalizeSettings({prompt:'  original  ',seed:7}).prompt,'original');
  assert.equal(normalizeSettings({prompt:'x'.repeat(2001),seed:7}).prompt.length,2000);
});

test('translation mode takes precedence over an advanced prompt and survives normalization',()=>{
  assert.equal(usesDirectImagePrompt({prompt:'גבר בחולצה כחולה',promptMode:'translate'}),false);
  const settings=normalizeSettings({prompt:'A man in a blue shirt',promptMode:'translate',seed:7});
  assert.equal(settings.promptMode,'translate');
  assert.deepEqual(normalizeSettings(settings),settings);
  assert.throws(()=>normalizeSettings({prompt:'x'.repeat(2001),promptMode:'translate'}));
});

test('face tokens can use the original Hebrew subject without expanding the translation',()=>{
  assert.equal(directImagePrompt('A portrait by the window','אדם ליד החלון'),'A portrait by the window, '+quality);
  assert.equal(directImagePrompt('A red house','בית אדום'),'A red house');
});
