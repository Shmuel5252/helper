import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workerAuthorized, parseWorkerMessage, outputAsset, validMedia, browserContext, browserPrompt } from './archive/worker-contract.ts';
const id='12345678-1234-4234-8234-123456789abc';

test('attachment-only follow-up retains an explicit current request after context',()=>{
 assert.equal(browserPrompt('previous\n','video',''), 'previous\nצור סרטון מהתמונה המצורפת.');
 assert.equal(browserPrompt('previous\n','image','  '), 'previous\nערוך את התמונה המצורפת.');
 assert.equal(browserPrompt('previous\n','image','make it blue'), 'previous\nmake it blue');
});
test('follow-up context includes only completed turns from the same conversation',()=>{
 const rows=[{conversation_id:id,status:'completed',input:'make it blue',output:[{type:'text',text:'done'}]},
 {conversation_id:'other',status:'completed',input:'private other device',output:[]},
 {conversation_id:id,status:'running',input:'unfinished',output:[]}];
 const text=browserContext(id,rows);
 assert(text.includes('make it blue'));assert(!text.includes('private other'));assert(!text.includes('unfinished'));
 assert(browserContext(id,[...rows,{...rows[0],input:'x'.repeat(40000)}]).length<=8200);
});
test('worker credential is separate and rejects empty/incorrect tokens',()=>{
  assert.equal(workerAuthorized('Bearer '+ 'x'.repeat(48),'x'.repeat(48)),true);
  for(const value of [null,'Bearer wrong','x'.repeat(48)])assert.equal(workerAuthorized(value,'x'.repeat(48)),false);
  assert.equal(workerAuthorized('Bearer ',''),false);
});
test('worker operations reject arbitrary URLs, oversized files and undeclared operations',()=>{
  assert.throws(()=>parseWorkerMessage({action:'source',id,token:id,url:'https://evil.example/app/x'}));
  assert.throws(()=>parseWorkerMessage({action:'reserve',id,token:id,mime:'video/mp4',size:52428801,sha256:'a'.repeat(64)}));
  assert.throws(()=>parseWorkerMessage({action:'sql',id,token:id}));
  assert.equal(parseWorkerMessage({action:'source',id,token:id,url:'https://gemini.google.com/app/abc123'}).action,'source');
  assert.equal(parseWorkerMessage({action:'response',id,token:id,text:'Cannot create this video.'}).action,'response');
  for(const text of ['', '   ', 'a'.repeat(8001), 42])assert.throws(()=>parseWorkerMessage({action:'response',id,token:id,text}));
});
test('output identity is deterministic and magic bytes must match media type',()=>{
  const f=outputAsset(id,'image/png',12,'a'.repeat(64));
  assert.deepEqual(f,outputAsset(id,'image/png',12,'a'.repeat(64)));
  assert.equal(validMedia(Buffer.from('<html>login</html>'),'image/png'),false);
  assert.equal(validMedia(Buffer.from([137,80,78,71,13,10,26,10]),'image/png'),true);
  assert.equal(validMedia(Buffer.from('0000ftypisom'),'video/mp4'),true);
});
