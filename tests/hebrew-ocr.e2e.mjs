// Opt-in live vision test: real mobile file input, real chat API, synthetic text only.
// Run explicitly with .env.local; this makes four model requests.
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';

const base=new URL(process.env.BASE_URL||process.env.IMAGE_APP_URL);
const requestedModelKey=process.env.OCR_MODEL_KEY?.trim()||null;
const hebrew=[
  'הודעה לדיירי הבניין',
  'ביום שלישי, 17.11.2026, יבוצעו עבודות תחזוקה.',
  'העבודות יתחילו בשעה 08:30 ויסתיימו בשעה 12:00.',
  'יש לפנות את החניה עד השעה 08:00.',
  'עלות העבודה: 240 ש״ח לכל דירה.',
  'אין צורך להגיע למשרד או לשלוח מסמכים.',
  'לפרטים נוספים פנו לוועד הבית.',
  'תודה על שיתוף הפעולה!',
].join('\n');
const mixed=[
  'אישור איסוף הזמנה',
  'שם הלקוח: יעל כהן',
  'מספר הזמנה: AB-204',
  'הערה: Pickup only',
  'שם המוצר: Blue notebook',
  'כמות: 3 יחידות',
  'נא לשמור את האישור.',
].join('\n');
const outputDir=process.env.OCR_OUTPUT_DIR||'.local-images/hebrew-ocr';
await mkdir(outputDir,{recursive:true});
const browser=await chromium.launch();
const fixturePage=await browser.newPage({viewport:{width:1100,height:850}});
await fixturePage.setContent('<html lang="he"><meta charset="utf-8"><body style="margin:0;background:white"><pre id="sheet" dir="rtl" style="box-sizing:border-box;width:1050px;margin:0;padding:54px 46px;color:#111;font:29px/1.9 Arial,sans-serif;white-space:pre-wrap;unicode-bidi:plaintext"></pre></body></html>');
for(const [name,text] of [['hebrew',hebrew],['mixed',mixed]]){
  await fixturePage.locator('#sheet').evaluate((el,text)=>{el.textContent=text;},text);
  await fixturePage.locator('#sheet').screenshot({path:`${outputDir}/${name}.png`});
}
await fixturePage.close();
// Allow presentation wrappers and typographic quote variants, but never extra content.
const normalize=text=>text.trim().replace(/^```[^\r\n]*\r?\n/,'').replace(/\r?\n```$/,'')
  .normalize('NFC').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,'')
  .replace(/^(?:#{1,6}\s+|>\s*)/gm,'').replace(/[״“”]/g,'"').replace(/[׳‘’]/g,"'")
  .replace(/\*|`/g,'').replace(/\s+/g,' ').trim();
const translationChecks=text=>({
  english:!/[א-ת]/.test(text),
  residents:/\b(?:residents?|tenants?)\b/i.test(text)&&/\bbuilding\b/i.test(text),
  tuesday:/\btuesday\b/i.test(text),
  date:/\b17[.\/-]11[.\/-]2026\b|\bnov(?:ember)?\.?\s+17(?:th)?,?\s+2026\b|\b17(?:th)?\s+nov(?:ember)?\.?,?\s+2026\b/i.test(text),
  maintenance:/\bmaintenance\b/i.test(text),
  startsAt0830:/\b0?8:30\b/i.test(text),
  endsAtNoon:/\b12:00\b|\bnoon\b/i.test(text),
  clearParking:/(?:clear|vacat|remov)[\s\S]{0,100}(?:parking|cars?|vehicles?)|(?:parking|cars?|vehicles?)[\s\S]{0,100}(?:clear|vacat|remov)/i.test(text),
  parkingDeadline:/\b0?8:00\b|\b8\s*a\.?m\.?/i.test(text),
  cost:/\b240\b/.test(text)&&/\b(?:NIS|ILS|shekels?)\b|₪/i.test(text),
  perApartment:/\b(?:per|each|every)\s+(?:apartment|unit|flat)\b/i.test(text),
  noOfficeOrDocuments:/(?:no need|not necessary|not required|do not need|don't need|need not|do not have to|don't have to)[\s\S]{0,160}\b(?:office|documents?|paperwork)\b/i.test(text)
    &&/\boffice\b/i.test(text)&&/\b(?:documents?|paperwork)\b/i.test(text),
  contactCommittee:/\b(?:committee|HOA)\b|\bbuilding\s+(?:management|board)\b/i.test(text),
  thanks:/\bthank/i.test(text)&&/\b(?:cooperation|collaboration)\b/i.test(text),
});
const report=[];
const cases=[
  {name:'hebrew-unfiltered',fixture:'hebrew',blocked:false,prompt:'העתק את כל הטקסט שבתמונה לפי הסדר. החזר את הטקסט בלבד.',expected:hebrew},
  {name:'hebrew-filtered',fixture:'hebrew',blocked:true,prompt:'העתק את כל הטקסט שבתמונה לפי הסדר. החזר את הטקסט בלבד.',expected:hebrew},
  {name:'mixed-filtered-no-translation-request',fixture:'mixed',blocked:true,prompt:'הוצא את כל הטקסט שבתמונה לפי הסדר. החזר את הטקסט בלבד.',expected:mixed},
  {name:'hebrew-filtered-explicit-translation',fixture:'hebrew',blocked:true,prompt:'תרגם לאנגלית את כל הטקסט שבתמונה. החזר את התרגום בלבד.',translate:true},
];
try{
  for(const testCase of cases){
    const external=[];
    const result={name:testCase.name,requestedModelKey,actualModelKey:null,passed:false,stage:'opening browser',expected:testCase.expected,prompt:testCase.prompt,answer:null,visible:null,externalBrowserRequests:external};
    report.push(result);
    await writeFile(`${outputDir}/results.json`,JSON.stringify(report,null,2));
    let context,page;
    try{
      context=await browser.newContext({viewport:{width:375,height:812},isMobile:true,hasTouch:true,locale:'he-IL',serviceWorkers:'block'});
      if(requestedModelKey)await context.addInitScript(key=>{try{localStorage.setItem('ai-chat:model',key);}catch{}},requestedModelKey);
      const session=createHmac('sha256',process.env.ACCESS_CODE).update('ai-chat-session-v1').digest('hex');
      await context.addCookies([{name:'ai_chat_session',value:session,url:base.origin,httpOnly:true,secure:base.protocol==='https:',sameSite:'Lax'}]);
      if(process.env.IMAGE_PREVIEW_SHARE){
        const link=new URL('/',base);link.searchParams.set('_vercel_share',process.env.IMAGE_PREVIEW_SHARE);
        try{await context.request.get(link.href);}catch{throw Error('Preview authorization failed');}
      }
      if(testCase.blocked)await context.route('**/*',route=>{
        const url=new URL(route.request().url());
        if(['http:','https:'].includes(url.protocol)&&url.origin!==base.origin){external.push(url.origin);return route.abort('blockedbyclient');}
        return route.continue();
      });
      page=await context.newPage();
      result.stage='loading image controls';
      await page.goto(base.href,{waitUntil:'networkidle'});
      await page.getByRole('button',{name:'צירוף תמונה',exact:true}).waitFor({timeout:30000});
      result.stage='uploading image';
      await page.getByTestId('image-input').setInputFiles(`${outputDir}/${testCase.fixture}.png`);
      await page.getByRole('img',{name:'תמונה מצורפת 1',exact:true}).waitFor();
      await page.getByRole('textbox',{name:'הודעה',exact:true}).fill(testCase.prompt);
      result.stage='waiting for model';
      const [response]=await Promise.all([
        page.waitForResponse(r=>new URL(r.url()).pathname==='/api/chat'&&r.request().method()==='POST',{timeout:90000}),
        page.getByRole('button',{name:'שליחה',exact:true}).click(),
      ]);
      const payload=response.request().postDataJSON();
      result.actualModelKey=payload.modelKey??null;
      result.httpStatus=response.status();
      assert.ok(payload.messages.at(-1).images?.[0]?.startsWith('data:image/jpeg;base64,'),'The actual UI did not upload the processed image');
      result.answer=await response.text();
      if(requestedModelKey)assert.equal(result.actualModelKey,requestedModelKey,'The UI selected a different model than requested');
      assert.equal(response.status(),200,`Chat returned HTTP ${response.status()}`);
      assert.ok(!result.answer.includes('\u0000'),'The model stream ended with an error');
      result.stage='checking rendered answer';
      await page.getByRole('button',{name:'עצירה',exact:true}).waitFor({state:'detached',timeout:90000});
      result.visible=await page.locator('.msg-in .md').last().innerText();
      assert.equal(normalize(result.visible),normalize(result.answer),'Rendered text differs from the model response');
      if(testCase.translate){
        result.checks=translationChecks(result.answer);
        assert.deepEqual(Object.entries(result.checks).filter(([,passed])=>!passed).map(([name])=>name),[],'Translation omitted or changed source facts');
      }else{
        assert.equal(normalize(result.answer),normalize(testCase.expected),'OCR changed the source or added unsolicited text/translation');
        assert.equal(normalize(result.visible),normalize(testCase.expected),'The rendered OCR text is not faithful to the source');
      }
      assert.deepEqual(external,[],'OCR required an external browser origin');
      result.passed=true;
      result.stage='complete';
    }catch(error){
      result.error=error instanceof Error?error.message:String(error);
    }finally{
      if(page)try{await page.screenshot({path:`${outputDir}/${testCase.name}.png`,fullPage:true});}catch(error){result.screenshotError=error instanceof Error?error.message:String(error);}
      await writeFile(`${outputDir}/results.json`,JSON.stringify(report,null,2));
      console.log(JSON.stringify({name:testCase.name,passed:result.passed,requestedModelKey,actualModelKey:result.actualModelKey,stage:result.stage,httpStatus:result.httpStatus,externalRequests:external.length,error:result.error,answer:result.answer}));
      await context?.close().catch(()=>{});
    }
  }
  assert.ok(report.every(r=>r.passed),'One or more OCR/language checks failed; inspect the saved report.');
  console.log('PASS: real Hebrew image upload and faithful text extraction with/without external-origin blocking; translation only when requested.');
}finally{await browser.close();}
