// Local provisioning helper; never commit or print the generated env files.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
const path='.env.local';
let env=await readFile(path,'utf8');
let secret=env.match(/^GEMINI_WORKER_SECRET=(.+)$/m)?.[1]?.trim();
if(!secret){secret=randomBytes(32).toString('hex');env+='\nGEMINI_WORKER_SECRET='+secret+'\n';await writeFile(path,env);}
await mkdir('test-screenshots/oracle',{recursive:true});
await writeFile('test-screenshots/oracle/gemini-worker.env',`APP_ORIGIN=https://helper-zeta-eight.vercel.app\nSTORAGE_HOST=mkfevvjrwmpowiaklqbj.supabase.co\nGEMINI_WORKER_SECRET=${secret}\n`,{mode:0o600});
console.log('Worker environment files prepared.');
