import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const base='http://127.0.0.1:3000',out='test-screenshots/realistic';await mkdir(out,{recursive:true});
const browser=await chromium.launch();
try{
 const context=await browser.newContext({viewport:{width:1280,height:900}});
 const login=await context.request.post(base+'/api/login',{form:{code:process.env.ACCESS_CODE},maxRedirects:0});assert.equal(login.status(),303);assert.ok(login.headers()['set-cookie']);
 const page=await context.newPage();await page.goto(base);
 await page.getByText('הגדרות מתקדמות לתמונה',{exact:true}).waitFor({timeout:120000});
 const cfg=await(await context.request.get(base+'/api/images/config')).json();assert.equal(cfg.mode,'local');assert.equal(cfg.promptAI,false);assert.equal(cfg.worker,'ready');
 let cloudWrites=0;page.on('request',r=>{if(r.method()==='POST'&&(/\/api\/(?:chat|gemini)/.test(r.url())))cloudWrites++;});
 await page.getByRole('textbox',{name:'הודעה',exact:true}).fill('Create an image of a small wooden cabin beside a peaceful lake at sunrise, photorealistic, soft golden light');
 await page.getByRole('button',{name:'שליחה',exact:true}).click();
 const done=page.locator('[data-testid="realistic-image"][data-media-status="done"]');await done.waitFor({timeout:420000});await done.locator('img').evaluate(el=>el.decode());
 assert.equal(cloudWrites,0);
 await page.screenshot({path:out+'/actual-local-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.locator('aside').waitFor({state:'hidden'});
 await page.screenshot({path:out+'/actual-local-mobile.png',fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 const media=await page.evaluate(()=>JSON.parse(localStorage.getItem('ai-chat:v2')).conversations[0].messages.at(-1).media);
 const file=await context.request.get(base+media.url+'?download=1');assert.equal(file.status(),200);await writeFile(out+'/actual-local-cabin.png',await file.body());
 await page.reload();await done.waitFor();
 await writeFile(out+'/actual-local-result.json',JSON.stringify({jobId:media.jobId,seed:media.settings.seed,cloudWrites,settings:media.settings},null,2));
 console.log('PASS actual project on port 3000: login, existing worker, real image in chat, mobile, download, history; no image/archive cloud POSTs');
}finally{await browser.close();}
