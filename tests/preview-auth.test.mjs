import {test} from 'node:test';
import assert from 'node:assert/strict';
import {previewAccess} from '../scripts/image-worker/preview-auth.mjs';

test('Preview sessions refresh automatically after a week without changing the stored credential',async t=>{
  let now=0,calls=0;
  t.mock.method(Date,'now',()=>now);
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.equal(url.origin,'https://preview.example');
    assert.equal(url.searchParams.get('_vercel_share'),'test-private-credential');
    assert.equal(options.redirect,'manual');
    calls++;
    return new Response(null,{status:307,headers:{'Set-Cookie':`_vercel_jwt=session-${calls}; Secure; HttpOnly; Path=/`}});
  });
  const access=previewAccess(new URL('https://preview.example'),{IMAGE_PREVIEW_SHARE:'test-private-credential'});
  assert.deepEqual(await access(),{Cookie:'_vercel_jwt=session-1'});
  now=14*60*1000;assert.deepEqual(await access(),{Cookie:'_vercel_jwt=session-1'});assert.equal(calls,1);
  now=8*24*60*60*1000;assert.deepEqual(await access(),{Cookie:'_vercel_jwt=session-2'});assert.equal(calls,2);
});

test('Revoked Preview access fails closed without following an authentication redirect',async t=>{
  t.mock.method(globalThis,'fetch',async(_url,options)=>{
    assert.equal(options.redirect,'manual');
    return new Response(null,{status:302,headers:{Location:'https://vercel.com/sso-api'}});
  });
  const access=previewAccess(new URL('https://preview.example'),{IMAGE_PREVIEW_SHARE:'revoked-test-value'});
  await assert.rejects(access,/Preview authorization expired or unavailable/);
});
