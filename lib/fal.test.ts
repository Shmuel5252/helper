import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {falInput,parseFalJob,falOutput,verifyFalSignature,readLimited,submitFal} from './fal.ts';

test('media modes choose real image/video endpoints and bounded settings',()=>{
  const image=falInput('image','boat',[]);
  assert.equal(image.endpoint,'fal-ai/flux-2/klein/4b');
  assert.equal(image.input.num_images,1);
  const edit=falInput('image','blue boat',['data:image/jpeg;base64,YQ==']);
  assert.equal(edit.endpoint,'fal-ai/flux-2/klein/4b/edit');
  assert.deepEqual(edit.input.image_urls,['data:image/jpeg;base64,YQ==']);
  const video=falInput('video','boat',['data:image/jpeg;base64,YQ==']);
  assert.equal(video.endpoint,'minimax/h3-max-turbo/image-to-video');
  assert.equal(video.input.duration,5);assert.equal(video.input.resolution,'768P');
  assert.equal(video.input.enable_safety_checker,true);
  assert.throws(()=>falInput('video','boat',['a','b']));
});
const rid='764cabcf-b745-4b3e-ae38-1200304cf45b';
const queue=`https://queue.fal.run/fal-ai/flux-2/requests/${rid}`;
test('queue metadata is bound to request ID and trusted origin before key-bearing fetches',()=>{
  const body={request_id:rid,response_url:queue,status_url:queue+'/status'};
  assert.equal(parseFalJob(body,'fal-ai/flux-2/klein/4b').requestId,rid);
  for(const url of ['https://evil.example/a','https://queue.fal.run.evil.example/a','http://queue.fal.run/a',queue+'?evil=1'])
    assert.throws(()=>parseFalJob({...body,response_url:url},'fal-ai/flux-2/klein/4b'));
  assert.throws(()=>parseFalJob({...body,request_id:'other'},'fal-ai/flux-2/klein/4b'));
});
test('outputs reject refusals, missing videos, untrusted hosts and safety flags',()=>{
  assert.equal(falOutput('video',{video:{url:'https://v3b.fal.media/files/test.mp4'}}).mime,'video/mp4');
  for(const body of [{error:'failed'},{images:[]},{video:{url:'https://example.com/a.mp4'}},{video:{url:'http://127.0.0.1/a.mp4'}}])assert.throws(()=>falOutput('video',body));
  assert.throws(()=>falOutput('image',{images:[{url:'https://v3b.fal.media/a.jpg'}],has_nsfw_concepts:[true]}));
});
test('signed callbacks require correct raw body, freshness and signature',()=>{
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');const keys=[publicKey.export({format:'jwk'})];
  const raw=Buffer.from('{"status":"OK"}'),now=Date.now(),ts=String(Math.floor(now/1000));
  const headers=new Headers({'x-fal-webhook-request-id':rid,'x-fal-webhook-user-id':'account','x-fal-webhook-timestamp':ts});
  const message=[rid,'account',ts,createHash('sha256').update(raw).digest('hex')].join('\n');
  headers.set('x-fal-webhook-signature',sign(null,Buffer.from(message),privateKey).toString('hex'));
  assert.equal(verifyFalSignature(headers,raw,keys,now),true);
  assert.equal(verifyFalSignature(headers,Buffer.from('tampered'),keys,now),false);
  assert.equal(verifyFalSignature(headers,raw,keys,now+301000),false);
  headers.delete('x-fal-webhook-user-id');assert.equal(verifyFalSignature(headers,raw,keys,now),false);
});
test('streaming download enforces byte ceiling even without content length',async()=>{
  await assert.rejects(()=>readLimited(new Response(new Uint8Array(11)),10));
  assert.equal((await readLimited(new Response(new Uint8Array(9)),10)).length,9);
});
test('submission timeout is not retried or treated as definitely rejected',async()=>{
  let calls=0;
  await assert.rejects(()=>submitFal('secret',falInput('image','boat',[]),'https://app.example/api/fal/webhook',async()=>{calls++;throw new Error('lost response');}),/לא התקבל אישור/);
  assert.equal(calls,1);
});
