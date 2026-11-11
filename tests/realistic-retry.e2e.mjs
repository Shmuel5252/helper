// Client transport fault test. All generation/chat POSTs are intercepted locally.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch();
try{
 const context=await browser.newContext();
 await context.request.post('http://127.0.0.1:3000/api/login',{form:{code:process.env.ACCESS_CODE},maxRedirects:0});
 const page=await context.newPage();let first,second,chatBody;
 await page.route('**/api/images/jobs',async route=>{
   const request=route.request().postDataJSON();
   if(!first){first=request;await route.abort('connectionreset');}
   else{second=request;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({status:'failed',error:'בדיקת ניתוק ללא יצירת תמונה'})});}
 });
 await page.route('**/api/chat',async route=>{chatBody=route.request().postDataJSON();await route.fulfill({status:200,contentType:'text/plain',body:'תשובת צ׳אט רגילה נשמרה'});});
 await page.goto('http://127.0.0.1:3000');await page.getByText('הגדרות מתקדמות לתמונה',{exact:true}).waitFor();
 await page.getByRole('textbox',{name:'הודעה',exact:true}).fill('Create an image of a synthetic test tree');await page.getByRole('button',{name:'שליחה',exact:true}).click();
 await page.getByText('החיבור נקטע; בודק אם הבקשה נשמרה…',{exact:true}).waitFor();
 await page.reload();await page.getByRole('button',{name:'בדיקת השליחה מחדש — אותה בקשה',exact:true}).click();
 await page.getByText('בדיקת ניתוק ללא יצירת תמונה',{exact:true}).waitFor();
 assert.deepEqual(second,first);assert.equal(await page.getByTestId('realistic-image').count(),1);
 await page.getByRole('textbox',{name:'הודעה',exact:true}).fill('מה שלומך?');await page.getByRole('button',{name:'שליחה',exact:true}).click();
 await page.getByText('תשובת צ׳אט רגילה נשמרה',{exact:true}).waitFor();
 assert.equal(chatBody.archive,undefined);assert.deepEqual(chatBody.messages,[{role:'user',content:'מה שלומך?'}]);
 console.log('PASS disconnected POST survives reload, retry preserves exact request ID/body, one card only, ordinary chat still streams and private image prompts are excluded');
}finally{await browser.close();}
