process.loadEnvFile('.env.local');
for(const path of ['archive_browser_health?select=state,seen_at','archive_browser_jobs?select=id,phase,lease_until,created_at&order=created_at.desc&limit=5']){
 const r=await fetch(process.env.SUPABASE_URL+'/rest/v1/'+path,{headers:{apikey:process.env.SUPABASE_SECRET_KEY}});
 if(!r.ok)throw Error('Read failed: '+r.status);
 console.log(JSON.stringify(await r.json()));
}
