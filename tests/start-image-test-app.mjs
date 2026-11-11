// Synthetic local test environment: no project .env files or cloud credentials copied.
import {mkdtemp,cp,symlink,writeFile,readFile} from 'node:fs/promises';
import {compile} from '@tailwindcss/node';
import {Scanner} from '@tailwindcss/oxide';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
const root=process.argv[2]||await mkdtemp(join(tmpdir(),'ai-chat-images-'));
for(const item of ['app','components','lib','public','package.json','tsconfig.json','proxy.ts'])await cp(resolve(item),join(root,item),{recursive:true});
if(!process.argv[2])await symlink(resolve('node_modules'),join(root,'node_modules'),'junction');
const compiler=await compile(await readFile(resolve('app/globals.css'),'utf8'),{base:resolve('app'),onDependency(){}});
const scanner=new Scanner({sources:[{base:resolve('components'),pattern:'**/*.tsx',negated:false},{base:resolve('app'),pattern:'**/*.tsx',negated:false}]});
await writeFile(join(root,'app/globals.css'),compiler.build(scanner.scan()));
await writeFile(join(root,'next.config.mjs'),'export default {cacheComponents:true,partialPrefetching:true};');
const env={...process.env,VERCEL:'',ACCESS_CODE:'image-test-code',ADMIN_CODE:'',SUPABASE_URL:'',SUPABASE_SECRET_KEY:'',GEMINI_WORKER_SECRET:'',FAL_KEY:'',FAL_MEDIA_ENABLED:'false',AI_API_KEY:'mock',AI_BASE_URL:'http://127.0.0.1:4018/v1',AI_MODEL:'mock-image-planner',AI_MODELS:'',IMAGE_MODE:'local',IMAGE_WORKER_SECRET:'local-image-test-worker-secret-123456789',IMAGE_LOCAL_DATA_DIR:resolve(process.env.TEST_IMAGE_DATA||'.local-images/test-live'),IMAGE_CLOUD_CONSENT:'',IMAGE_PROMPT_AI_CONSENT:process.env.TEST_IMAGE_AI==='1'?'approved-v1':''};
const child=spawn(process.execPath,[resolve('node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','-p','3126'],{cwd:root,env,stdio:'inherit',windowsHide:true});
console.log('ISOLATED_IMAGE_ROOT='+root);
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
