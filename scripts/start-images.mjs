import {existsSync,openSync,closeSync,readFileSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'..');process.chdir(root);
const logDir=join(root,'.local-images','logs');await mkdir(logDir,{recursive:true});
const install=process.env.IMAGE_MODEL_DIR||'C:/Users/USER/Documents/Codex/2026-11-11/new-chat-2/local-image-ai';
const appURL=process.env.IMAGE_APP_URL||'http://127.0.0.1:3000';
const local=['127.0.0.1','localhost','[::1]'].includes(new URL(appURL).hostname);
const localChatURL=process.env.IMAGE_LOCAL_CHAT_URL||(local?appURL:null);
if(localChatURL){const u=new URL(localChatURL);if(u.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(u.hostname))throw Error('Local chat must use loopback HTTP');}
if(!local&&process.env.IMAGE_CLOUD_CONSENT!=='approved-v1')throw Error('Cloud privacy approval required');
if(!process.env.IMAGE_WORKER_SECRET||process.env.IMAGE_WORKER_SECRET.length<32)throw Error('Configure IMAGE_WORKER_SECRET in .env.local first');
function start(exe,args,cwd,name){
  const fd=openSync(join(logDir,name+'.log'),'a');
  const child=spawn(exe,args,{cwd,env:process.env,windowsHide:true,detached:true,stdio:['ignore',fd,fd]});
  child.on('error',()=>console.error(name+' could not start'));child.unref();closeSync(fd);
}
async function health(){try{const r=await fetch('http://127.0.0.1:7860/health',{signal:AbortSignal.timeout(3000)});return r.ok&&(await r.json()).service==='realistic-vision-local-v1';}catch{return false;}}
if(!await health()){
  const python=join(install,'.venv','Scripts','python.exe');
  if(!existsSync(python)||!existsSync(join(install,'launch.py')))throw Error('Set IMAGE_MODEL_DIR to the existing model installation');
  start(python,[join(install,'launch.py'),'--no-browser'],install,'model');
  console.log('Starting the existing local model (no installation changes)');
}
if(localChatURL){
  let running=false;try{await fetch(localChatURL,{signal:AbortSignal.timeout(3000)});running=true;}catch{}
  if(!running)start(process.execPath,[join(root,'node_modules','next','dist','bin','next'),'dev','--hostname','127.0.0.1','--port',new URL(localChatURL).port||'3000'],root,'chat');
}
let workerRunning=false;
try{const pid=Number(readFileSync(join(resolve(process.env.IMAGE_LOCAL_DATA_DIR||'.local-images'),'worker','worker.pid'),'utf8'));if(Number.isInteger(pid)&&pid>0){process.kill(pid,0);workerRunning=true;}}catch{}
if(!workerRunning)start(process.execPath,[join(root,'scripts','image-worker','worker.mjs')],root,'worker');
console.log('Chat: '+appURL+' | Logs: .local-images/logs');
