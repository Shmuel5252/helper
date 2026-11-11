import {test} from 'node:test';
import assert from 'node:assert/strict';
import {imageIntent, imageMetadata, normalizeSettings, automaticImageSettings, sameSeedIntent,validImageOrigin,type ImageJob} from './realistic-image.ts';

test('metadata preserves original Unicode whitespace separately and excludes credentials',()=>{
  const input='  צור תמונה של חתול 🐈\n ליד חלון  ';
  const job:ImageJob={id:'id',owner:'private-owner',request_hash:'private-hash',token:'secret',input,settings:normalizeSettings({prompt:'A cat beside a window'}),phase:'done',created_at:'2026-11-11',updated_at:'2026-11-11'};
  const metadata=JSON.parse(JSON.stringify(imageMetadata(job)));
  assert.equal(metadata.originalRequest,input);
  assert.equal(metadata.settings.prompt,'A cat beside a window');
  for(const key of ['owner','request_hash','token'])assert.equal(key in metadata,false);
});

test('origin checks use browser-visible Host rather than Next internal localhost URL',()=>{
  assert.equal(validImageOrigin(new Request('http://localhost:3126/api/images/jobs',{headers:{host:'127.0.0.1:3126',origin:'http://127.0.0.1:3126'}})),true);
  assert.equal(validImageOrigin(new Request('http://localhost:3126/api/images/jobs',{headers:{host:'127.0.0.1:3126',origin:'https://attacker.invalid'}})),false);
  assert.equal(validImageOrigin(new Request('https://app.example/api/images/jobs',{headers:{host:'app.example',origin:'https://app.example','sec-fetch-site':'cross-site'}})),false);
});

test('natural image requests and contextual variants do not swallow ordinary chat',()=>{
  for(const text of ['צור לי תמונה של חתול','תצייר לי נוף','Create an image of a cat','generate a photo of a tree'])assert.equal(imageIntent(text,false),true);
  assert.equal(imageIntent('צור גרסה נוספת',true),true);
  assert.equal(imageIntent('השתמש באותו Seed',true),true);
  assert.equal(imageIntent('צור גרסה נוספת',false),false);
  assert.equal(imageIntent('איך יוצרים תמונה?',false),false);
  assert.equal(imageIntent('Do not generate an image',false),false);
  assert.equal(sameSeedIntent('השתמש באותו Seed'),true);
});
test('model output is bounded to the actual local API; manual choices win',()=>{
  const s=normalizeSettings({prompt:'a cat',steps:900,guidance_scale:99,width:8192,height:300,seed:999999999999},{steps:12,guidance_scale:4,seed:42});
  assert.equal(s.steps,12);assert.equal(s.guidance_scale,4);assert.equal(s.seed,42);
  assert.equal(s.width,512);assert.equal(s.height,320);
  const d=normalizeSettings({prompt:'a tree'});
  assert.equal(d.steps,20);assert.equal(d.guidance_scale,6);assert.equal(d.width,512);
  assert.ok(d.seed>=0&&d.seed<=2147483647);
  assert.throws(()=>normalizeSettings({prompt:''}));
  assert.throws(()=>normalizeSettings({prompt:'ok'},{steps:NaN}));
});

test('image edit strength is bounded and always leaves a denoising step',()=>{
  assert.equal(normalizeSettings({prompt:'red mug',strength:3}).strength,0.9);
  assert.equal(normalizeSettings({prompt:'red mug',strength:0,steps:1}).steps,10);
  assert.equal(normalizeSettings({prompt:'red mug',strength:0.8},{strength:0.3}).strength,0.3);
  assert.throws(()=>normalizeSettings({prompt:'red mug',strength:NaN}));
});

test('automatic quality avoids tiny or under-sampled output while manual choices win',()=>{
  const s=automaticImageSettings({prompt:'a blue mug',steps:2,width:256,height:320,guidance_scale:12});
  assert.equal(s.steps,28);assert.equal(s.width,512);assert.equal(s.height,512);assert.equal(s.guidance_scale,7);
  const m=automaticImageSettings({prompt:'a blue mug'},{steps:20,width:384,height:448,guidance_scale:4});
  assert.equal(m.steps,20);assert.equal(m.width,384);assert.equal(m.height,448);assert.equal(m.guidance_scale,4);
});
