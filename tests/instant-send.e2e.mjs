// Isolated browser test: all API responses are mocked, no paid requests.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const base='http://localhost:3116';
const browser=await chromium.launch();
try{
  for(const [width,kind,succeeds] of [[390,'תמונה',false],[1280,'סרטון',false],[390,'סרטון',true]]){
    const context=await browser.newContext({viewport:{width,height:850}});
    const page=await context.newPage();
    let release;
    const gate=new Promise(resolve=>{release=resolve;});
    let submission=0,earlyPoll=0,turn,cid;
    await page.route('**/api/**',async route=>{
      const path=new URL(route.request().url()).pathname;
      if(path==='/api/models')return route.fulfill({json:{models:[]}});
      if(path==='/api/gemini/config')return route.fulfill({json:{available:true,models:[{key:'fal-image-v1',kind:'image',provider:'fal'},{key:'fal-video-v1',kind:'video',provider:'fal'}]}});
      if(path==='/api/gemini/conversations'&&route.request().method()==='POST'){
        await gate;
        cid=route.request().postDataJSON().id;
        if(succeeds)return route.fulfill({json:{id:cid}});
        return route.fulfill({status:503,json:{error:'לא הצלחנו לשלוח. אפשר לנסות שוב.'}});
      }
      if(path==='/api/gemini/turns'){
        submission++;
        const body=route.request().postDataJSON();
        const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('ai-chat:v2')));
        assert.ok(saved.conversations.some(c=>c.messages.some(m=>m.media?.jobId===body.id&&m.media.conversationId===cid)),'polling identity saved before sending');
        turn={id:body.id,status:'failed',output:[],error:'תשובת בדיקה מהשרת'};
        return route.fulfill({json:turn});
      }
      if(path.startsWith('/api/gemini/conversations/')){
        if(!cid)earlyPoll++;
        return route.fulfill({json:{conversation:{id:cid},turns:turn?[turn]:[],assets:[]}});
      }
      return route.fulfill({status:500,json:{error:'Unexpected test request'}});
    });
    await page.goto(base+'/?k=test-access');
    await page.getByRole('radio',{name:kind,exact:true}).click();
    await page.getByLabel('הודעה',{exact:true}).fill('בדיקת שליחה מידית');
    await page.locator('form button[type=submit]').click();
    try{
      await page.getByRole('main').getByText('בדיקת שליחה מידית',{exact:true}).waitFor({timeout:1500});
      assert.equal(await page.getByLabel('הודעה',{exact:true}).inputValue(),'');
      assert.equal(submission,0);
      assert.equal(earlyPoll,0);
      // A draft typed while upload is pending must survive the late failure.
      await page.getByLabel('הודעה',{exact:true}).fill('הטיוטה הבאה');
    }finally{release();}
    await page.getByRole('alert').filter({hasText:succeeds?'תשובת בדיקה מהשרת':'לא הצלחנו לשלוח'}).waitFor();
    assert.equal(await page.getByLabel('הודעה',{exact:true}).inputValue(),'הטיוטה הבאה');
    assert.equal(await page.getByRole('main').getByText('בדיקת שליחה מידית',{exact:true}).count(),1);
    assert.equal(submission,succeeds?1:0);
    await context.close();
  }
  console.log('PASS immediate message, empty composer before server response, preserved draft, visible failure, no premature polling or generation; mobile and desktop.');
}finally{await browser.close();}
