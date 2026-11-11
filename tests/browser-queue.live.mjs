// Exact-ID fixtures only. Run before enabling the real worker; no Gemini calls.
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
process.loadEnvFile('.env.local');
const base=process.env.SUPABASE_URL,secret=process.env.SUPABASE_SECRET_KEY;
async function db(path,body,method='POST'){
 const r=await fetch(base+'/rest/v1/'+path,{method,headers:{apikey:secret,'Content-Type':'application/json',Prefer:'return=representation'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 if(!r.ok)throw Error('DB fixture request failed: '+r.status);const text=await r.text();return text?JSON.parse(text):null;
}
const cid=randomUUID(),tid=randomUUID(),a=randomUUID(),b=randomUUID(),owner='e'.repeat(64),cancelCid=randomUUID(),cancelTid=randomUUID();
try{
 await db('archive_browser_health?on_conflict=id',{id:true,state:'ready',seen_at:new Date().toISOString()},'POST').catch(async()=>db('archive_browser_health?id=eq.true',{state:'ready',seen_at:new Date().toISOString()},'PATCH'));
 await db('archive_conversations',{id:cid,owner,title:'Queue protocol test'});
 const input={p_owner:owner,p_conversation:cid,p_id:tid,p_hash:'f'.repeat(64),p_model:'account-image',p_input:'fixture',p_assets:[]};
 await assert.rejects(db('rpc/archive_browser_enqueue',{...input,p_owner:'a'.repeat(64)}));
 assert.equal(await db('rpc/archive_browser_enqueue',input),true);
 assert.equal(await db('rpc/archive_browser_enqueue',input),false);
 assert.equal((await db('rpc/archive_browser_claim',{p_token:a}))[0].id,tid);
 assert.equal((await db('rpc/archive_browser_claim',{p_token:b})).length,0);
 const update=(token,action)=>db('rpc/archive_browser_update',{p_id:tid,p_token:token,p_action:action,p_data:{}});
 assert.equal(await update(b,'submit'),false);
 assert.equal(await update(a,'submit'),true);
 assert.equal(await db('rpc/archive_browser_update',{p_id:tid,p_token:a,p_action:'source',p_data:{url:'https://gemini.google.com/app/fixture'}}),true);
 await db('archive_browser_jobs?id=eq.'+tid,{lease_until:new Date(Date.now()-10000).toISOString()},'PATCH');
 assert.equal(await update(a,'complete'),false);
 await db('rpc/archive_browser_expire',{});
 const [turn]=await db('archive_turns?id=eq.'+tid,undefined,'GET');assert.equal(turn.status,'uncertain');
 assert.equal((await db('rpc/archive_browser_claim',{p_token:b})).length,0);
 assert.equal(await db('rpc/archive_browser_recover',{p_id:tid}),true);
 assert.equal(await db('rpc/archive_browser_recover',{p_id:tid}),false);
 const recovered=(await db('rpc/archive_browser_claim',{p_token:b}))[0];
 assert.equal(recovered.id,tid);assert.equal(recovered.source_url,'https://gemini.google.com/app/fixture');
 assert.equal(await update(a,'submit'),false);
 assert.equal(await update(b,'fail'),true);
 await db('archive_conversations',{id:cancelCid,owner,title:'Cancellation protocol test'});
 await db('rpc/archive_browser_enqueue',{...input,p_conversation:cancelCid,p_id:cancelTid});
 assert.equal((await db('rpc/archive_browser_claim',{p_token:b}))[0].id,cancelTid);
 assert.equal(await db('rpc/archive_browser_update',{p_id:cancelTid,p_token:b,p_action:'submit',p_data:{}}),true);
 await db('rpc/archive_delete_conversation',{p_id:cancelCid});
 assert.equal(await db('rpc/archive_browser_update',{p_id:cancelTid,p_token:b,p_action:'renew',p_data:{}}),false);
 assert.equal((await db('archive_browser_jobs?id=eq.'+cancelTid,undefined,'GET')).length,0);
 assert.equal(await db('rpc/archive_browser_recover',{p_id:cancelTid}),false);
 await assert.rejects(db('rpc/archive_browser_enqueue',{...input,p_conversation:cancelCid,p_id:cancelTid}));
 console.log('PASS: isolation, idempotency, single claim, expiry, explicit source-only recovery, deletion fencing and no resurrection');
}finally{
 await db('archive_turns?id=eq.'+tid,{status:'failed'},'PATCH').catch(()=>{});
 await db('rpc/archive_delete_conversation',{p_id:cid}).catch(()=>{});
 await db('rpc/archive_delete_conversation',{p_id:cancelCid}).catch(()=>{});
 await db('archive_browser_health?id=eq.true',{state:'offline'},'PATCH');
}
