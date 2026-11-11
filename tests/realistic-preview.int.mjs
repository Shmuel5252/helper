// Real remote integration test. Explicitly run only after cloud/privacy approval.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import {previewAccess} from '../scripts/image-worker/preview-auth.mjs';
const origin=new URL(process.env.IMAGE_APP_URL);
assert.equal(origin.protocol,'https:');
assert.equal(process.env.IMAGE_CLOUD_CONSENT,'approved-v1');
const dir=process.env.IMAGE_TEST_DATA_DIR||'.local-images/preview-test';await mkdir(dir,{recursive:true});
const file=dir+'/state.json';
const access=previewAccess(origin);
let state;try{state=JSON.parse(await readFile(file,'utf8'));}catch{state={id:randomUUID(),device:randomBytes(32).toString('hex'),text:'  צור לי תמונה מציאותית של ספל קרמיקה כחול על שולחן עץ ליד חלון.\nאור בוקר רך, עציץ קטן ברקע, ללא טקסט.  '};await writeFile(file,JSON.stringify(state),{mode:0o600});}
const protection=await access();
const login=await fetch(new URL('/api/login',origin),{method:'POST',headers:protection,body:new URLSearchParams({code:process.env.ACCESS_CODE}),redirect:'manual'});
assert.equal(login.status,303);
const session=login.headers.getSetCookie().find(v=>v.startsWith('ai_chat_session='))?.split(';')[0];assert.ok(session,'Existing access code must work');
const headers={...protection,Cookie:[protection.Cookie,session,'ai_chat_device='+state.device].filter(Boolean).join('; '),Origin:origin.origin};
async function request(path,body,overrides={}){
  return fetch(new URL(path,origin),{method:body?'POST':'GET',headers:{...headers,...(body?{'Content-Type':'application/json'}:{}),...overrides},body:body?JSON.stringify(body):undefined,redirect:'manual',signal:AbortSignal.timeout(60000)});
}
const health=await request('/api/images/config');assert.equal(health.status,200);const config=await health.json();assert.equal(config.mode,'cloud');assert.equal(config.promptAI,true);
if(process.argv.includes('prepare')){
  const publicPage=await fetch(origin,{redirect:'manual'});assert.ok([302,307,401].includes(publicPage.status));
  const unauth=await fetch(new URL('/api/images/config',origin),{headers:protection,redirect:'manual'});assert.ok([307,302,401].includes(unauth.status));
  assert.equal((await request('/api/worker/images',{action:'claim'})).status,401);
  assert.equal((await request('/api/images/jobs',{id:state.id,text:state.text},{Origin:'https://attacker.invalid'})).status,403);
  const models=await(await request('/api/models')).json();
  const body={id:state.id,text:state.text,modelKey:models.models[0].key,reuseSeed:false,settings:{}};
  state.body=body;await writeFile(file,JSON.stringify(state),{mode:0o600});
  const response=await request('/api/images/jobs',body);const job=await response.json();
  if(response.status!==200)throw Error('Enqueue failed: HTTP '+response.status+' '+(job.error??''));
  assert.equal(job.originalRequest,state.text);assert.equal(job.phase,'queued');
  assert.equal(job.statusText,'ממתין לשרת התמונות');assert.match(job.settings.prompt,/[a-zA-Z]/);assert.doesNotMatch(job.settings.prompt,/[\u0590-\u05ff]/);
  const duplicate=await(await request('/api/images/jobs',body)).json();assert.deepEqual(duplicate.settings,job.settings);assert.equal(duplicate.id,state.id);
  assert.equal((await request('/api/images/jobs',{...body,text:'different request'})).status,409);
  const otherCookie=[protection.Cookie,session,'ai_chat_device='+randomBytes(32).toString('hex')].filter(Boolean).join('; ');
  assert.equal((await request('/api/images/jobs/'+state.id,undefined,{Cookie:otherCookie})).status,404);
  state.settings=job.settings;await writeFile(file,JSON.stringify(state),{mode:0o600});
  console.log('PASS protected Preview, app login, worker authorization, CSRF, live LLM translation, original text, durable offline queue, idempotency and owner isolation');
  console.log(JSON.stringify({id:state.id,phase:job.phase,steps:job.settings.steps,seed:job.settings.seed,width:job.settings.width,height:job.settings.height}));
}else if(process.argv.includes('finish')){
  let job;
  for(let i=0;i<100;i++){
    const r=await request('/api/images/jobs/'+state.id);assert.equal(r.status,200);job=await r.json();
    if(job.status==='done')break;if(job.status==='failed')throw Error('Generation failed: '+job.error);
    if(i%6===0)console.log('Remote image phase:',job.phase);
    await new Promise(r=>setTimeout(r,4000));
  }
  assert.equal(job.status,'done');assert.equal(job.originalRequest,state.text);assert.deepEqual(job.settings,state.settings);
  const image=await request(job.url);assert.equal(image.status,302);
  const signed=image.headers.get('location');assert.equal(new URL(signed).origin,new URL(process.env.SUPABASE_URL).origin);
  // Do not forward Preview credentials or app cookies to Storage.
  const pngResponse=await fetch(signed);assert.equal(pngResponse.status,200);const png=Buffer.from(await pngResponse.arrayBuffer());assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  await writeFile(dir+'/remote-image.png',png);
  const downloaded=await request(job.url+'?download=1');assert.equal(downloaded.status,302);const download=await fetch(downloaded.headers.get('location'));assert.deepEqual(Buffer.from(await download.arrayBuffer()),png);
  const metaResponse=await request('/api/images/jobs/'+state.id+'?download=metadata');assert.match(metaResponse.headers.get('content-disposition'),/attachment/);const metadata=await metaResponse.json();assert.equal(metadata.originalRequest,state.text);assert.deepEqual(metadata.settings,state.settings);assert.equal('owner' in metadata,false);await writeFile(dir+'/remote-image.json',JSON.stringify(metadata,null,2));
  state.signed=signed;state.signedAt=Date.now();await writeFile(file,JSON.stringify(state),{mode:0o600});
  console.log('PASS real Vercel -> private cloud queue -> Windows worker -> local GPU -> private cloud PNG, authenticated download, original request metadata and seed');
  console.log(JSON.stringify({id:job.id,bytes:png.length,seed:job.settings.seed,phase:job.phase}));
}else if(process.argv.includes('expiry')){
  assert.ok(Date.now()-state.signedAt>65000,'Wait 65 seconds before expiry check');
  const old=await fetch(state.signed);assert.notEqual(old.status,200);
  const fresh=await request('/api/images/jobs/'+state.id+'/file');assert.equal(fresh.status,302);assert.equal((await fetch(fresh.headers.get('location'))).status,200);
  console.log('PASS expired private image URL denied; fresh authorized URL works');
}else if(process.argv.includes('audit')){
  const base=process.env.SUPABASE_URL;
  const serverHeaders={apikey:process.env.SUPABASE_SECRET_KEY,Authorization:'Bearer '+process.env.SUPABASE_SECRET_KEY};
  const saved=await fetch(base+'/rest/v1/realistic_jobs?id=eq.'+state.id+'&select=input,settings,phase,created_at,updated_at,image_id',{headers:serverHeaders});assert.equal(saved.status,200);const rows=await saved.json();assert.equal(rows.length,1);assert.equal(rows[0].input,state.text);assert.deepEqual(rows[0].settings,state.settings);assert.equal(rows[0].phase,'done');
  const bucket=await(await fetch(base+'/storage/v1/bucket/realistic-images',{headers:serverHeaders})).json();assert.equal(bucket.public,false);assert.equal(bucket.file_size_limit,2000000);
  assert.equal((await fetch(base+'/rest/v1/realistic_jobs?select=id&limit=1')).status,401);
  const info={id:state.id,originalRequestExact:true,privateBucket:true,rows:rows.length,createdAt:rows[0].created_at,completedAt:rows[0].updated_at,seed:state.settings.seed,worker:config.worker};
  await writeFile(dir+'/verified.json',JSON.stringify(info,null,2));console.log('PASS actual Supabase original text and settings persisted, one row only, private bucket and anonymous database denial');console.log(JSON.stringify(info));
}else console.log(JSON.stringify({mode:config.mode,worker:config.worker,promptAI:config.promptAI}));
