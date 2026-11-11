// Explicit owner operation. Only the saved result is downloaded, never generated.
process.loadEnvFile('.env.local');
const id=process.argv[2];
if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id??''))throw Error('Exact job UUID required');
const r=await fetch(process.env.SUPABASE_URL+'/rest/v1/rpc/archive_browser_recover',{method:'POST',headers:{apikey:process.env.SUPABASE_SECRET_KEY,'Content-Type':'application/json'},body:JSON.stringify({p_id:id})});
if(!r.ok||await r.json()!==true)throw Error('Saved result is not eligible for recovery');
console.log('Queued saved-result recovery: '+id);
