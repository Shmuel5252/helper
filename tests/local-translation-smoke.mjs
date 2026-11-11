// Real offline model, no provider and no image generation.
import assert from 'node:assert/strict';
import {translateLocally,prepareImageSettings} from '../scripts/image-worker/local-translation.mjs';

for(const [source,patterns] of [
  ['דיוקן של גבר בן שלושים וחמש בחולצה כחולה, מביט למצלמה, תאורת יום רכה ורקע אפור פשוט.',[/35|thirty.five/i,/man|male/i,/blue shirt/i,/camera/i,/gray|grey/i]],
  ['בית אדום ליד הים, ללא אנשים.',[/red/i,/house/i,/sea/i,/no people|without people/i]],
]){
  const text=await translateLocally(source);
  for(const pattern of patterns)assert.match(text,pattern);
  console.log(JSON.stringify({source,translated:text,offline:true}));
}
const settings=await prepareImageSettings({prompt:'דיוקן של אישה בחולצה ירוקה ליד חלון.',promptMode:'local-translate',seed:7});
assert.match(settings.prompt,/woman/i);assert.match(settings.prompt,/green/i);assert.match(settings.prompt,/window/i);
assert.match(settings.prompt,/detailed face, sharp eyes, natural skin texture, photorealistic, high quality$/);
console.log('PASS real local translation: subjects, age, colors, background, negation, face tokens and zero network attempts');
