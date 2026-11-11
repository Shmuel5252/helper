// Neutral real end-to-end edit and independent archive verification, after deployment approval.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {sessionToken,adminToken} from '../lib/auth.ts';
import {removeLocalChat,transcriptConversation} from '../lib/unified-chat.ts';
const origin=new URL(process.env.IMAGE_APP_URL);
assert.equal(origin.protocol,'https:');
const dir='.local-images/edit-test';await mkdir(dir,{recursive:true});
let state;try{state=JSON.parse(await readFile(dir+'/remote-state.json','utf8'));}catch{state={id:randomUUID(),conversationId:randomUUID(),device:randomBytes(32).toString('hex'),text:'  שנה את הספל בתמונה לאדום ושמור על השולחן והחלון.\nתאורת בוקר טבעית.  '};}
const headers={Origin:origin.origin,Cookie:`ai_chat_session=${await sessionToken(process.env.ACCESS_CODE)}; ai_chat_device=${state.device}`};
async function call(path,body,other={}){return fetch(new URL(path,origin),{method:body?'POST':'GET',headers:{...headers,...(body?{'Content-Type':'application/json'}:{}),...other},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});}
async function transcript(){const r=await call('/api/gemini/conversations/'+state.conversationId);assert.equal(r.status,200);return r.json();}
if(process.argv.includes('prepare')){
  assert.equal((await call('/api/gemini/conversations',{id:state.conversationId,title:'בדיקת עריכת תמונה וארכיון'})).status,200);
  const form=new FormData();form.set('conversationId',state.conversationId);form.set('file',new Blob([await readFile('.local-images/production-test/remote-image.png')],{type:'image/png'}),'source.png');
  const upload=await fetch(new URL('/api/gemini/assets',origin),{method:'POST',headers,body:form});assert.equal(upload.status,200);state.sourceAssetId=(await upload.json()).id;
  const config=await(await call('/api/models')).json();
  state.body={id:state.id,conversationId:state.conversationId,sourceAssetId:state.sourceAssetId,text:state.text,modelKey:config.models[0].key,reuseSeed:false,settings:{prompt:'A red ceramic mug on a wooden table beside a window, soft morning light, a small green plant in the background, realistic photograph',strength:0.65,seed:251112,steps:20}};
  await writeFile(dir+'/remote-state.json',JSON.stringify(state),{mode:0o600});
  const response=await call('/api/images/jobs',state.body);assert.equal(response.status,200, 'Edit enqueue');
  const job=await response.json();assert.equal(job.originalRequest,state.text);assert.equal(job.settings.sourceAssetId,state.sourceAssetId);
  const same=await call('/api/images/jobs',state.body);assert.equal(same.status,200);assert.equal((await same.json()).id,state.id);
  const archived=await transcript();assert.equal(archived.turns.find(t=>t.id===state.id)?.input,state.text);
  const foreign=await call('/api/images/jobs',{...state.body,id:randomUUID()},{Cookie:`ai_chat_session=${await sessionToken(process.env.ACCESS_CODE)}; ai_chat_device=${randomBytes(32).toString('hex')}`});assert.equal(foreign.status,404);
  console.log('PASS source upload, owner isolation, exact original request, retry deduplication and immediate archive before any deletion');
}else if(process.argv.includes('finish')){
  let job;
  for(let n=0;n<100;n++){
    const r=await call('/api/images/jobs/'+state.id);assert.equal(r.status,200);job=await r.json();
    if(job.status==='done')break;
    assert.notEqual(job.status,'failed',job.error);
    await new Promise(r=>setTimeout(r,4000));
  }
  assert.equal(job.status,'done');assert.equal(job.originalRequest,state.text);
  const response=await call(job.url);assert.equal(response.status,200);const png=Buffer.from(await response.arrayBuffer());
  const source=await readFile('.local-images/production-test/remote-image.png');
  assert.notEqual(createHash('sha256').update(png).digest('hex'),createHash('sha256').update(source).digest('hex'));
  await writeFile(dir+'/remote-edit.png',png);
  // Completion has a durable result delivery journal; allow its separate archive write to finish.
  let saved;for(let n=0;n<12;n++){saved=await transcript();if(saved.turns.find(t=>t.id===state.id)?.status==='completed')break;await new Promise(r=>setTimeout(r,2000));}
  const turn=saved.turns.find(t=>t.id===state.id);assert.equal(turn.status,'completed');assert.equal(turn.input,state.text);assert.deepEqual(turn.assets,[state.sourceAssetId]);
  const result=turn.output.find(o=>o.type==='image');assert.equal(result.realistic.originalRequest,state.text);assert.equal(result.realistic.settings.seed,251112);
  const restored=transcriptConversation(saved);assert.deepEqual(removeLocalChat([restored],restored.id),[]);
  const stillSaved=await transcript();assert.deepEqual(stillSaved,saved);
  const archiveFile=await call('/api/gemini/assets/'+result.assetId);assert.equal(archiveFile.status,200);assert.deepEqual(Buffer.from(await archiveFile.arrayBuffer()),png);
  // Admin archive also backfills older images; do not output private page contents.
  const adminPage=await call('/admin/archive?id='+state.conversationId,undefined,{Cookie:headers.Cookie+`; ai_chat_admin=${await adminToken(process.env.ADMIN_CODE)}`});assert.equal(adminPage.status,200);assert.ok((await adminPage.text()).includes('Realistic Vision V5.1'));
  const evidence={id:job.id,conversationId:state.conversationId,originalExact:true,archiveBeforeDeletion:true,archiveSurvivesRemoval:true,sourceAndOutputArchived:true,seed:job.settings.seed,strength:job.settings.strength,bytes:png.length};
  await writeFile(dir+'/remote-verified.json',JSON.stringify(evidence,null,2));console.log(evidence);
}
