// Verify all legacy image entry points reject before provider dispatch; no paid generation.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {sessionToken} from '../lib/auth.ts';
const origin=new URL(process.env.TEST_APP_URL||process.env.IMAGE_APP_URL);
const headers={Origin:origin.origin,'Content-Type':'application/json',Cookie:`ai_chat_session=${await sessionToken(process.env.ACCESS_CODE)}; ai_chat_device=${randomBytes(32).toString('hex')}`};
async function call(path,body){return fetch(new URL(path,origin),{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined,redirect:'manual',signal:AbortSignal.timeout(60000)});}
const cfg=await call('/api/images/config');assert.equal(cfg.status,200);const images=await cfg.json();assert.equal(images.enabled,true);
const media=await call('/api/gemini/config');assert.equal(media.status,200);assert.ok((await media.json()).models.every(m=>m.kind==='video'));
for(const modelKey of ['account-image','fal-image-v1']){
  const response=await call('/api/gemini/turns',{id:randomUUID(),conversationId:randomUUID(),modelKey,text:'Synthetic routing check: a blue ceramic mug',assets:[]});
  assert.equal(response.status,409);assert.match((await response.json()).error,/Realistic Vision/);
}
for(const endpoint of ['/api/media/generate','/api/media/quote']){
  const response=await call(endpoint,{kind:'image',key:'lite',prompt:'Synthetic routing check',credits:0});assert.equal(response.status,409);assert.match((await response.json()).error,/Realistic Vision/);
}
// A video request reaches normal conversation validation, proving the image-only block does not capture videos.
const providerConfig=await(await call('/api/gemini/config')).json();
const videoKey=providerConfig.models.find(m=>m.kind==='video')?.key||'account-video';
const video=await call('/api/gemini/turns',{id:randomUUID(),conversationId:randomUUID(),modelKey:videoKey,text:'Synthetic video routing check',assets:[]});
assert.equal(video.status,404);
console.log('PASS Realistic enabled; account/fal/OpenArt image requests blocked; external media offers videos only; video route preserved without starting generation');
