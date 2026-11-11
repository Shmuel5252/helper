import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {captureDownload} from '../scripts/gemini-worker/download.mjs';

for(const pageFirst of [true,false])test(`download belongs to worker page, including popup downloads (${pageFirst})`,async()=>{
 const cdp=new EventEmitter(),page=new EventEmitter();
 const expected={url:()=> 'https://example.test/result',suggestedFilename:()=> 'video.mp4'};
 const button={click:async()=>{
  cdp.emit('Browser.downloadWillBegin',{guid:'unrelated',url:'https://example.test/other',suggestedFilename:'video.mp4'});
  cdp.emit('Browser.downloadProgress',{guid:'unrelated',state:'completed'});
  if(pageFirst)page.emit('download',expected);
  cdp.emit('Browser.downloadWillBegin',{guid:'correct',frameId:'popup-frame',url:expected.url(),suggestedFilename:expected.suggestedFilename()});
  cdp.emit('Browser.downloadProgress',{guid:'correct',state:'completed'});
  if(!pageFirst)page.emit('download',expected);
 }};
 assert.equal(await captureDownload(cdp,page,button,100),'correct');
 assert.equal(cdp.listenerCount('Browser.downloadProgress'),0);
 assert.equal(page.listenerCount('download'),0);
});
