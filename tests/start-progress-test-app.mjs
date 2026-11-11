// Isolated UI fixture. No real credentials, database, provider or submissions.
import {mkdtemp,cp,symlink,writeFile,mkdir,readFile} from 'node:fs/promises';
import {compile} from '@tailwindcss/node';
import {Scanner} from '@tailwindcss/oxide';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
const root=await mkdtemp(join(tmpdir(),'ai-chat-progress-'));
for(const item of ['app','components','lib','public','package.json','tsconfig.json'])await cp(resolve(item),join(root,item),{recursive:true});
await symlink(resolve('node_modules'),join(root,'node_modules'),'junction');
// Match the production Tailwind compiler while using Webpack for this local fixture.
const compiler=await compile(await readFile(resolve('app/globals.css'),'utf8'),{base:resolve('app'),onDependency(){}});
const scanner=new Scanner({sources:[{base:resolve('components'),pattern:'**/*.tsx',negated:false},{base:resolve('app'),pattern:'**/*.tsx',negated:false}]});
await writeFile(join(root,'app/globals.css'),compiler.build(scanner.scan()));
await writeFile(join(root,'next.config.mjs'),'export default {cacheComponents:true};');
const control=resolve('test-screenshots/progress-fixture.json');
await writeFile(control,JSON.stringify({status:'uncertain',offline:false,allowRetry:true,requests:[],attempts:0}));
const state=`import {readFile} from 'node:fs/promises';\nconst fixture=async()=>JSON.parse(await readFile(${JSON.stringify(control)},'utf8'));\n`;
const cid='11111111-1111-4111-8111-111111111111';
const tid='22222222-2222-4222-8222-222222222222';
await writeFile(join(root,'app/api/gemini/config/route.ts'),state+`export async function GET(){const x=await fixture();return Response.json(x.offline?{error:'offline'}:{available:true,models:[{key:'account-video',label:'Gemini · יצירת סרטון',kind:'video'},{key:'account-image',label:'Gemini · תמונות',kind:'image'}]},{status:x.offline?503:200});}`);
await writeFile(join(root,'app/api/gemini/conversations/[id]/route.ts'),state+`export async function GET(){const x=await fixture();if(x.offline)return Response.json({error:'offline'},{status:503});const original={id:'${tid}',conversation_id:'${cid}',sequence:1,model_key:'account-video',input:'דוגמה מקומית לבדיקת חיווי — לא נשלחה ל־Gemini',assets:[],status:x.status,provider_id:null,input_hash:'fixture',output:x.status==='completed'?[{type:'text',text:'תוצאה לדוגמה בלבד'}]:[],error:null,created_at:new Date().toISOString(),checked_at:new Date().toISOString()};return Response.json({conversation:{id:'${cid}',title:'בדיקה מקומית'},assets:[],turns:[original,...(x.requests??[]).map((r:any,i:number)=>({...original,id:r.id,input:r.text,assets:r.assets,model_key:r.modelKey,status:'starting',sequence:i+2,output:[]}))]});}`);
await writeFile(join(root,'app/api/gemini/turns/[id]/route.ts'),`export async function POST(){return Response.json({ok:true});}`);
await writeFile(join(root,'app/api/gemini/turns/route.ts'),state+`import {writeFile} from 'node:fs/promises';export async function POST(request:Request){const input=await request.json();const x=await fixture();x.attempts=(x.attempts??0)+1;if(x.allowRetry&&!x.requests.some((r:any)=>r.id===input.id))x.requests.push(input);await writeFile(${JSON.stringify(control)},JSON.stringify(x));return x.allowRetry?Response.json({id:input.id,status:'starting',error:null}):Response.json({error:'שגיאה מדומה בבדיקת השליחה'},{status:503});}`);
await mkdir(join(root,'app/progress-fixture'),{recursive:true});
await writeFile(join(root,'app/progress-fixture/page.tsx'),`'use client'; export default function Page(){return <button onClick={()=>{localStorage.setItem('ai-chat:gemini:index:v1',JSON.stringify([{id:'${cid}',title:'בדיקה מקומית'}]));location.href='/gemini';}}>פתיחת בדיקה מקומית</button>;}`);
const env={...process.env,ACCESS_CODE:'',ADMIN_CODE:'',SUPABASE_URL:'http://127.0.0.1:1',SUPABASE_SECRET_KEY:'fixture',GEMINI_WORKER_SECRET:'',GEMINI_API_KEY:'',AI_API_KEY:''};
const child=spawn(process.execPath,[resolve('node_modules/next/dist/bin/next'),'dev','--webpack','-p','3111'],{cwd:root,env,stdio:'inherit'});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
