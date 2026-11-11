// Read-only metadata diagnosis. Never submits prompts or prints credentials/content.
process.loadEnvFile('.env.local');
const path='archive_turns?select=model_key,status,error,created_at&order=created_at.desc&limit=20';
const response=await fetch(process.env.SUPABASE_URL+'/rest/v1/'+path,{headers:{apikey:process.env.SUPABASE_SECRET_KEY}});
if(!response.ok)throw Error('Metadata read failed: '+response.status);
console.log(JSON.stringify(await response.json()));
