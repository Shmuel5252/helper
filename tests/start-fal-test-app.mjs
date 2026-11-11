// No project .env files, credentials or external providers are loaded.
import {mkdtemp,cp,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
const root=await mkdtemp(join(tmpdir(),'ai-chat-fal-'));
for(const item of ['app','components','lib','public','package.json','tsconfig.json','proxy.ts'])await cp(resolve(item),join(root,item),{recursive:true});
await symlink(resolve('node_modules'),join(root,'node_modules'),'junction');
await writeFile(join(root,'next.config.mjs'),'export default {cacheComponents:true};');
// Isolated checks exercise routes, not Tailwind compilation.
await writeFile(join(root,'app/globals.css'),'');
const env={...process.env,ACCESS_CODE:'test-access',ADMIN_CODE:'test-admin',SUPABASE_URL:'http://localhost:4040',SUPABASE_SECRET_KEY:'mock-supabase-secret',GEMINI_WORKER_SECRET:'',AI_API_KEY:'mock',AI_BASE_URL:'http://localhost:4010/v1',AI_MODEL:'mock-fast',AI_MODELS:'',FAL_KEY:'isolated-fal-key',MEDIA_PROVIDER:'fal',FAL_MEDIA_ENABLED:'true',FAL_PUBLIC_ORIGIN:'https://test.example',FAL_DAILY_LIMIT_USD:'1',KV_REST_API_URL:'http://localhost:4030',KV_REST_API_TOKEN:'test',NODE_OPTIONS:`--import ${pathToFileURL(resolve('tests/mock-fal-fetch.mjs')).href}`};
const child=spawn(process.execPath,[resolve('node_modules/next/dist/bin/next'),'dev','--webpack','-p','3116'],{cwd:root,env,stdio:'inherit'});
console.log('ISOLATED_ROOT='+root);
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
