// Opt-in live test. Generates one local image in each mobile profile, never resubmits saved jobs.
// Run with .env.local. Use a fresh LOCAL_IMAGE_TEST_STATE for a new live run.
import assert from 'node:assert/strict';
import {createHmac,randomBytes} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';

const base=new URL(process.env.BASE_URL||process.env.IMAGE_APP_URL);
const folder='.local-images/mobile-local-planner';
const statePath=process.env.LOCAL_IMAGE_TEST_STATE||`${folder}/state.json`;
await mkdir(folder,{recursive:true});
let state;
try{state=JSON.parse(await readFile(statePath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;state={};}
const save=()=>writeFile(statePath,JSON.stringify(state,null,2),{mode:0o600});
const browser=await chromium.launch();
try{
  for(const sample of [{name:'regular-phone',modelKey:'deep',blocked:false},{name:'filtered-phone',modelKey:'alt',blocked:true}]){
    const saved=state[sample.name]??={device:randomBytes(32).toString('hex')};
    await save();
    const context=await browser.newContext({viewport:{width:412,height:915},isMobile:true,hasTouch:true,locale:'he-IL',serviceWorkers:'block'});
    const session=createHmac('sha256',process.env.ACCESS_CODE).update('ai-chat-session-v1').digest('hex');
    await context.addCookies([{name:'ai_chat_session',value:session},{name:'ai_chat_device',value:saved.device}].map(cookie=>({...cookie,url:base.origin,httpOnly:true,secure:true,sameSite:'Lax'})));
    await context.addInitScript(key=>{localStorage.setItem('ai-chat:model',key);localStorage.setItem('ai-chat:image-provider','realistic');},sample.modelKey);
    const external=[];
    if(sample.blocked)await context.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(['http:','https:'].includes(url.protocol)&&url.origin!==base.origin){external.push(url.origin);return route.abort('blockedbyclient');}
      return route.continue();
    });
    const page=await context.newPage();
    try{
      await page.goto(base.href,{waitUntil:'networkidle'});
      if(!saved.jobId){
        await page.getByRole('radio',{name:'תמונה',exact:true}).click();
        await page.getByRole('textbox',{name:'הודעה',exact:true}).fill('מנוע של רכב');
        const [request]=await Promise.all([
          page.waitForRequest(r=>new URL(r.url()).pathname==='/api/images/jobs'&&r.method()==='POST'),
          page.getByRole('button',{name:'יצירת תמונה',exact:true}).click(),
        ]);
        const payload=request.postDataJSON();
        saved.jobId=payload.id;saved.modelKey=payload.modelKey;saved.settings=payload.settings;
        await save();
        assert.equal(payload.modelKey,sample.modelKey);
        assert.equal(payload.settings.prompt,undefined,'Test must exercise automatic planning');
        assert.ok([undefined,'ai'].includes(payload.settings.promptMode));
        console.log(sample.name,'submitted',saved.jobId,'saved chat model',saved.modelKey);
      }
      let result,lastPhase;
      const deadline=Date.now()+600000;
      while(Date.now()<deadline){
        const response=await page.evaluate(async id=>{const r=await fetch(`/api/images/jobs/${id}`);return {status:r.status,body:await r.json()};},saved.jobId);
        result=response.body;
        const alerts=(await page.getByRole('alert').allTextContents()).map(x=>x.trim()).filter(Boolean);
        assert.deepEqual(alerts,[],'Image creation displayed an error');
        if(response.status===404){await new Promise(r=>setTimeout(r,2000));continue;}
        assert.equal(response.status,200,JSON.stringify(result));
        if(result.phase!==lastPhase){console.log(sample.name,result.phase);lastPhase=result.phase;}
        if(result.phase==='done')break;
        assert.ok(!['failed','uncertain'].includes(result.phase),result.error||result.phase);
        await new Promise(r=>setTimeout(r,5000));
      }
      assert.equal(result?.phase,'done','Existing job did not finish; rerun resumes its status without duplicating it');
      assert.equal(result.originalRequest,'מנוע של רכב');
      assert.match(result.settings.prompt,/engine/i);
      assert.ok(result.url.startsWith('/api/images/jobs/'));
      const loaded=await page.evaluate(async url=>{
        const response=await fetch(url,{redirect:'error'});
        if(response.status!==200)throw Error(`Image HTTP ${response.status}`);
        const img=document.createElement('img');img.alt='תוצאת בדיקת מנוע של רכב';img.style.cssText='position:fixed;inset:100px 12px auto;width:calc(100% - 24px);z-index:9999;background:white';
        const ready=new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error('Image did not load'));});
        img.src=url;document.body.append(img);await ready;
        return {width:img.naturalWidth,height:img.naturalHeight,type:response.headers.get('content-type')};
      },result.url);
      assert.equal(loaded.type,'image/png');assert.ok(loaded.width>0&&loaded.height>0);
      assert.deepEqual(external,[]);
      saved.passed=true;saved.result={url:result.url,settings:result.settings,...loaded};await save();
      await page.screenshot({path:`${folder}/${sample.name}.png`,fullPage:true});
      console.log('PASS',sample.name,JSON.stringify(loaded),'external browser requests',external.length);
    }finally{await context.close();}
  }
}finally{await browser.close();}
