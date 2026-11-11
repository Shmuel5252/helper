// Isolated application with only local providers; never loads project credentials.
import {mkdtemp,cp,symlink,writeFile,readFile} from 'node:fs/promises';
import {compile} from '@tailwindcss/node';
import {Scanner} from '@tailwindcss/oxide';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
const root=process.argv[2]??await mkdtemp(join(tmpdir(),'ai-chat-unified-'));
for(const item of ['app','components','lib','public','package.json','tsconfig.json','proxy.ts'])await cp(resolve(item),join(root,item),{recursive:true});
if(!process.argv[2])await symlink(resolve('node_modules'),join(root,'node_modules'),'junction');
const compiler=await compile(await readFile(resolve('app/globals.css'),'utf8'),{base:resolve('app'),onDependency(){}});
const scanner=new Scanner({sources:[{base:resolve('components'),pattern:'**/*.tsx',negated:false},{base:resolve('app'),pattern:'**/*.tsx',negated:false}]});
await writeFile(join(root,'app/globals.css'),compiler.build(scanner.scan()));
await writeFile(join(root,'next.config.mjs'),'export default {cacheComponents:true};');
const env={...process.env,ACCESS_CODE:'',ADMIN_CODE:'test-admin',SUPABASE_URL:'http://localhost:4040',SUPABASE_SECRET_KEY:'mock-supabase-secret',GEMINI_WORKER_SECRET:'local-fixture-worker-secret-123456789',GEMINI_API_KEY:'',AI_API_KEY:'mock',AI_BASE_URL:'http://localhost:4010/v1',AI_MODEL:'mock-fast',AI_MODELS:'fast|mock-fast|מהיר|לרוב השאלות|none|1',AI_REASONING_EFFORT:'none'};
const child=spawn(process.execPath,[resolve('node_modules/next/dist/bin/next'),'dev','--webpack','-p','3115'],{cwd:root,env,stdio:'inherit'});
console.log('ISOLATED_ROOT='+root);
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
