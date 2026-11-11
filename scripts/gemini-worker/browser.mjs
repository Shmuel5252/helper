import {chromium} from 'playwright';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {imageTool,videoTool} from './selectors.mjs';
import {captureDownload} from './download.mjs';
import {generationUnavailable} from './response.mjs';
import {waitForMediaComposer,submitMedia} from './composer.mjs';
import {generationPrompt} from './prompt.mjs';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const sourcePattern=/^https:\/\/gemini\.google\.com\/app\/[a-zA-Z0-9_-]+$/;
export class GeminiBrowser{
  async connect(){
    if(this.browser?.isConnected())return;
    this.browser=await chromium.connectOverCDP('http://127.0.0.1:9222');
    const context=this.browser.contexts()[0];
    this.page=context.pages().find(p=>p.url().startsWith('https://gemini.google.com/'))??await context.newPage();
    this.page.setDefaultTimeout(20000);
    this.downloadDir='/home/gemini-browser/snap/chromium/common/worker-downloads';
    await mkdir(this.downloadDir,{recursive:true,mode:0o700});
    this.cdp=await this.browser.newBrowserCDPSession();
    await this.cdp.send('Browser.setDownloadBehavior',{behavior:'allowAndName',downloadPath:this.downloadDir,eventsEnabled:true});
    if(!this.page.url().startsWith('https://gemini.google.com/'))await this.page.goto('https://gemini.google.com/app');
  }
  async ready(){
    try{await this.connect();return await this.page.getByRole('link',{name:/^(חשבון Google:|Google Account:)/}).isVisible();}catch{return false;}
  }
  async prepare(job){
    if(!await this.ready())throw Error('login-required');
    await this.page.goto('https://gemini.google.com/app',{waitUntil:'domcontentloaded'});
    const editor=this.page.getByRole('textbox',{name:/כאן מזינים פרומפט ל-Gemini|Enter a prompt for Gemini/});
    await editor.waitFor({state:'visible'});
    if(job.kind==='video'){
      await this.page.getByRole('button',{name:/פתיחת בורר המצבים|Open mode picker/}).click();
      await this.page.getByRole('menu').getByText(/3\.1 Pro/).click();
    }
    await this.page.getByRole('button',{name:/^(העלאה וכלים|Uploads and tools|Add files and tools)$/}).click();
    await this.page.getByRole('menu',{name:/^(האפשרויות בתפריט|Menu options)$/}).getByText(job.kind==='video'?videoTool:imageTool).click();
    await waitForMediaComposer(this.page,job.kind);
    if(job.inputs.length){
      this.temp=await mkdtemp(join(this.downloadDir,'input-'));
      const files=[];
      for(const a of job.inputs){
        const url=new URL(a.url);
        if(url.protocol!=='https:'||url.hostname!==process.env.STORAGE_HOST||!url.pathname.startsWith('/storage/v1/object/sign/chat-archive/'))throw Error('invalid-input-url');
        const response=await fetch(url,{signal:AbortSignal.timeout(30000),redirect:'error'});
        if(!response.ok)throw Error('input-download');
        const bytes=Buffer.from(await response.arrayBuffer());
        if(bytes.length>52428800)throw Error('input-too-large');
        const path=join(this.temp,`${a.id}.${a.mime.split('/')[1]}`);await writeFile(path,bytes,{mode:0o600});files.push(path);
      }
      const chooser=this.page.waitForEvent('filechooser');
      if(job.kind==='video'){
        await this.page.getByRole('button',{name:/^(העלאת קבצים|Upload files)$/}).click();
      }else{
        await this.page.getByRole('button',{name:/^(העלאה וכלים|Uploads and tools|Add files and tools)$/}).click();
        await this.page.getByRole('menu',{name:/^(האפשרויות בתפריט|Menu options)$/}).getByText(/^(העלאת קבצים|Upload files)$/).click();
      }
      await (await chooser).setFiles(files);
    }
    await editor.fill(generationPrompt(job));
    this.editor=editor;
    this.kind=job.kind;
  }
  async submit(){await submitMedia(this.page,this.kind);}
  async resume(job){
    if(!sourcePattern.test(job.source)||!await this.ready())throw Error('recovery-source-or-login');
    await this.page.goto(job.source,{waitUntil:'domcontentloaded'});
    if(this.page.url()!==job.source)throw Error('recovery-source-changed');
  }
  async result(job,check,recordSource){
    let savedSource=job.source??'';
    let terminalText='';
    const download=this.page.getByRole('button',{name:job.kind==='video'?/^(הורדת הסרטון|Download video)$/:/^(הורדת תמונה בגודל מלא|Download full size|Download full-size image)$/});
    for(let tick=0;tick<180;tick++){
      check();
      const url=this.page.url();
      if(!url.startsWith('https://gemini.google.com/'))throw Error('login-required');
      if(savedSource&&url!==savedSource)throw Error('source-changed');
      if(sourcePattern.test(url)&&url!==savedSource){await recordSource(url);savedSource=url;}
      if(await download.count()===1){
        await download.scrollIntoViewIfNeeded();
        const guid=await this.downloadOriginal(download);
        const path=join(this.downloadDir,guid);
        const bytes=await readFile(path);await rm(path);
        if(!bytes.length||bytes.length>52428800)throw Error('output-size');
        const mime=bytes[0]===137?'image/png':bytes[0]===255?'image/jpeg':bytes.toString('ascii',0,4)==='RIFF'?'image/webp':bytes.toString('ascii',4,8)==='ftyp'?'video/mp4':null;
        if(!mime||(job.kind==='video')!==(mime==='video/mp4'))throw Error('output-type');
        const text=(await this.page.locator('[id^="model-response-message-content"]').allTextContents()).join('\n').slice(0,8000);
        return {bytes,mime,source:savedSource,text};
      }
      // Only inspect visible response text for known stopping conditions. Never execute it.
      const response=await this.page.locator('[id^="model-response-message-content"]').allTextContents();
      const text=(response.at(-1)??'').trim().slice(0,8000);
      // Require a stable refusal across reads; never treat a progress message as final.
      if(text&&generationUnavailable(text)){
        if(text===terminalText)return {terminalText:text};
        terminalText=text;
      }else terminalText='';
      await pause(5000);
    }
    throw Error('generation-timeout');
  }
  async downloadOriginal(button){
    return captureDownload(this.cdp,this.page,button);
  }
  async cleanup(){if(this.temp){await rm(this.temp,{recursive:true,force:true});this.temp=null;}}
}
