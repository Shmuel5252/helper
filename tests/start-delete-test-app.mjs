// Isolated source copy: never loads real credentials or modifies the live dev app.
import {mkdtemp,cp,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
const root=await mkdtemp(join(tmpdir(),'ai-chat-delete-'));
for(const item of ['app','components','lib','public','package.json','tsconfig.json','proxy.ts'])await cp(resolve(item),join(root,item),{recursive:true});
await symlink(resolve('node_modules'),join(root,'node_modules'),'junction');
await writeFile(join(root,'next.config.mjs'),'export default {cacheComponents:true};');
const env={...process.env,ACCESS_CODE:'test-code-123',ADMIN_CODE:'admin-test',CRON_SECRET:'cron-test',SUPABASE_URL:'http://localhost:4040',SUPABASE_SECRET_KEY:'mock-supabase-secret',GEMINI_API_KEY:'mock-gemini-key',GEMINI_API_BASE_URL:'http://localhost:4040/v1beta',GEMINI_WORKER_SECRET:'',AI_API_KEY:'mock'};
const child=spawn(process.execPath,[resolve('node_modules/next/dist/bin/next'),'dev','--webpack','-p','3110'],{cwd:root,env,stdio:'inherit'});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
