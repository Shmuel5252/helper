import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareAttachment} from './gemini-upload.ts';

test('small photos are unchanged; oversized photos become bounded JPEGs',async()=>{
 const small=new File(['photo'],'small.png',{type:'image/png'});
 assert.equal(await prepareAttachment(small,async()=>{throw Error('must not resize');}),small);
 const original=new File([new Uint8Array(4_000_001)],'phone.png',{type:'image/png'});
 const result=await prepareAttachment(original,async()=>({full:'data:image/jpeg;base64,/9j/AA==',thumb:''}));
 assert.equal(result.name,'phone.jpg');assert.equal(result.type,'image/jpeg');assert.equal(result.size,4);
 assert.equal(original.size,4_000_001);
});
test('large documents and excessive images fail before decoding',async()=>{
 for(const f of [new File([new Uint8Array(4_000_001)],'x.pdf',{type:'application/pdf'}),new File([new Uint8Array(31*1024*1024)],'x.jpg',{type:'image/jpeg'})]){
  await assert.rejects(prepareAttachment(f,async()=>{assert.fail('must not decode');}),/גדול/);
 }
});
