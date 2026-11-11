// Maintenance integration check: download the already-created result on the
// exact supplied source page. Never sends a prompt or creates new media.
import {GeminiBrowser} from './browser.mjs';
import {createHash} from 'node:crypto';
const source=process.argv[2],kind=process.argv[3];
if(!/^https:\/\/gemini\.google\.com\/app\/[a-zA-Z0-9_-]+$/.test(source??'')||!['image','video'].includes(kind))throw Error('Exact source and kind required');
const adapter=new GeminiBrowser();
await adapter.connect();
if(adapter.page.url()!==source)throw Error('Browser is not on the expected result');
const result=await adapter.result({kind},()=>{},async url=>{if(url!==source)throw Error('Unexpected source');});
console.log(JSON.stringify({mime:result.mime,size:result.bytes.length,sha256:createHash('sha256').update(result.bytes).digest('hex')}));
await adapter.browser.close();
