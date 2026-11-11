// Production compile of the current app in an isolated directory, with Tailwind
// compiled in-process to avoid the Windows Turbopack CSS child-process failure.
import {mkdtemp,cp,symlink,writeFile,readFile} from 'node:fs/promises';
import {compile} from '@tailwindcss/node';
import {Scanner} from '@tailwindcss/oxide';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
const root=process.argv[2]||await mkdtemp(join(tmpdir(),'ai-chat-build-'));
for(const item of ['app','components','lib','public','package.json','tsconfig.json','proxy.ts'])await cp(resolve(item),join(root,item),{recursive:true});
if(!process.argv[2])await symlink(resolve('node_modules'),join(root,'node_modules'),'junction');
const compiler=await compile(await readFile(resolve('app/globals.css'),'utf8'),{base:resolve('app'),onDependency(){}});
const scanner=new Scanner({sources:[{base:resolve('components'),pattern:'**/*.tsx',negated:false},{base:resolve('app'),pattern:'**/*.tsx',negated:false}]});
await writeFile(join(root,'app/globals.css'),compiler.build(scanner.scan()));
await writeFile(join(root,'next.config.mjs'),'export default {cacheComponents:true,partialPrefetching:true};');
console.log('ISOLATED_BUILD_ROOT='+root);
const env={...process.env,FAL_KEY:'',FAL_MEDIA_ENABLED:'false',AI_API_KEY:'',GEMINI_WORKER_SECRET:'',SUPABASE_SECRET_KEY:'',IMAGE_MODE:'off',IMAGE_WORKER_SECRET:'',IMAGE_CLOUD_CONSENT:'',IMAGE_PROMPT_AI_CONSENT:''};
const child=spawn(process.execPath,[resolve('node_modules/next/dist/bin/next'),'build','--webpack'],{cwd:root,env,stdio:'inherit'});
child.on('exit',code=>{process.exitCode=code??1;});
