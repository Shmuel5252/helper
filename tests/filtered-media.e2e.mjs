// Mobile capability recovery while every external browser origin is blocked.
// Config/quote requests are mocked; no paid generation or account changes occur.
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';

const base=new URL(process.env.BASE_URL||'http://127.0.0.1:3101');
const code=process.env.ACCESS_CODE||'test-code-123';
const browser=await chromium.launch();
const context=await browser.newContext({viewport:{width:375,height:812},isMobile:true,hasTouch:true,locale:'he-IL'});
await context.addCookies([{name:'ai_chat_session',value:createHmac('sha256',code).update('ai-chat-session-v1').digest('hex'),url:base.origin,httpOnly:true,secure:base.protocol==='https:',sameSite:'Lax'}]);
if(process.env.IMAGE_PREVIEW_SHARE){
  const access=new URL('/',base);access.searchParams.set('_vercel_share',process.env.IMAGE_PREVIEW_SHARE);
  await context.request.get(access.href);
}
const counts={models:0,media:0};
const foreign=[];
let failAgain=false;
const media={configured:true,available:true,image:[{key:'lite',label:'חסכוני',description:'תמונה',modelName:'Image model'}],video:[{key:'pixverse',label:'סרטון קצר',description:'סרטון',modelName:'Video model'}],usage:{spent:0,cap:null,remaining:null}};
await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(!['http:','https:'].includes(url.protocol))return route.continue();
  if(url.origin!==base.origin){foreign.push(url.origin);return route.abort('blockedbyclient');}
  if(url.pathname==='/api/models'){
    counts.models++;
    if(counts.models===1||failAgain)return route.abort('blockedbyclient');
    return route.fulfill({json:{models:[{key:'fast',label:'מהיר',description:'בדיקה',vision:true,group:'fast',modelName:'Test model'}]}});
  }
  if(url.pathname==='/api/media/config'){
    counts.media++;
    if(counts.media===1||failAgain)return route.abort('blockedbyclient');
    return route.fulfill({json:media});
  }
  if(url.pathname==='/api/images/config')return route.fulfill({json:{enabled:true,mode:'cloud',promptAI:false,worker:'ready'}});
  if(url.pathname==='/api/media/quote')return route.fulfill({json:{credits:1,affordable:true,cap:null,remaining:null}});
  if(route.request().method==='POST'&&url.pathname!=='/api/media/quote')throw Error('Unexpected mutation in read-only browser test');
  return route.continue();
});
const page=await context.newPage();
const waitFor=async(predicate,message)=>{
  const deadline=Date.now()+10000;
  while(Date.now()<deadline){if(await predicate())return;await new Promise(r=>setTimeout(r,100));}
  throw Error(message);
};
try{
  await page.goto(base.href,{waitUntil:'networkidle'});
  await waitFor(()=>counts.models>0&&counts.media>0,'Initial capability requests did not run');
  assert.equal(await page.getByRole('button',{name:'צירוף תמונה',exact:true}).count(),0,'Initial blocked models should reproduce the missing image control');
  assert.equal(await page.getByRole('textbox',{name:'הודעה',exact:true}).isVisible(),true);
  console.log('PASS: reproduced missing image control after blocked initial config, with text chat still visible');
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await waitFor(()=>counts.models>1&&counts.media>1,'Capabilities did not retry on reconnection');
  await page.getByRole('button',{name:'צירוף תמונה',exact:true}).waitFor();
  console.log('PASS: image controls recovered without a page reload');
  for(const mode of ['צ׳אט','תמונה','סרטון']){
    await page.getByRole('radio',{name:mode,exact:true}).click();
    await page.getByTestId('image-input').setInputFiles('tests/fixtures/sample.png');
    await page.getByRole('img',{name:'תמונה מצורפת 1',exact:true}).waitFor();
    await waitFor(()=>page.getByRole('img',{name:'תמונה מצורפת 1',exact:true}).evaluate(el=>el.complete&&el.naturalWidth>0),'Attached image did not render');
    await page.getByRole('textbox',{name:'הודעה',exact:true}).fill('A small cabin beside a lake');
    const submit=mode==='צ׳אט'?page.getByRole('button',{name:'שליחה',exact:true}):page.getByRole('button',{name:/^יצירה ·/});
    await waitFor(()=>submit.isEnabled(),`Submit stayed disabled in ${mode}`);
    await page.getByRole('button',{name:'הסרת תמונה 1',exact:true}).click();
    console.log(`PASS: mobile image attachment and enabled submission in ${mode}`);
  }
  const previous={...counts};
  failAgain=true;
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await waitFor(()=>counts.models>previous.models&&counts.media>previous.media,'Focus did not refresh capabilities');
  assert.equal(await page.getByRole('button',{name:'צירוף תמונה',exact:true}).isVisible(),true,'Transient failure discarded known media capabilities');
  assert.deepEqual(foreign,[],'The UI requested an external browser origin');
  await mkdir('test-screenshots',{recursive:true});
  await page.screenshot({path:'test-screenshots/filtered-media-mobile.png'});
  console.log('PASS: later failures preserve controls; all browser traffic remained on the chat origin');
}finally{await browser.close();}
