import {createHash,createHmac} from 'node:crypto';
process.loadEnvFile('.env.local');
const id=process.argv[2];
if(!/^[a-f0-9-]{36}$/.test(id??''))throw Error('Exact job UUID required');
const db=async(path)=>{const r=await fetch(process.env.SUPABASE_URL+'/rest/v1/'+path,{headers:{apikey:process.env.SUPABASE_SECRET_KEY}});if(!r.ok)throw Error('Database '+r.status);return r.json();};
const [turn]=await db('archive_turns?id=eq.'+id);
const [job]=await db('archive_browser_jobs?id=eq.'+id);
console.log(JSON.stringify({id,status:turn?.status,phase:job?.phase,source:job?.source_url,fileReserved:!!job?.file,conversation:turn?.conversation_id}));
if(turn?.status==='completed'){
 const asset=turn.output.find(x=>x.assetId)?.assetId;
 const r=await fetch(process.env.SUPABASE_URL+'/storage/v1/object/chat-archive/'+turn.conversation_id+'/'+asset,{headers:{apikey:process.env.SUPABASE_SECRET_KEY}});
 const bytes=Buffer.from(await r.arrayBuffer());
 const matches=bytes.length===job.file.size&&createHash('sha256').update(bytes).digest('hex')===job.file.sha256;
 if(!r.ok||!matches)throw Error('Archive hash verification failed');
 const site='https://helper-zeta-eight.vercel.app';
 const cookie='ai_chat_session='+createHmac('sha256',process.env.ACCESS_CODE).update('ai-chat-session-v1').digest('hex')+'; ai_chat_device='+'b'.repeat(64);
 const other=await fetch(site+'/api/gemini/conversations/'+turn.conversation_id,{headers:{Cookie:cookie}});
 if(other.status!==404)throw Error('Unrelated device isolation failed: '+other.status);
 const ownerCookie='ai_chat_admin='+createHmac('sha256',process.env.ADMIN_CODE).update('ai-chat-admin-v1').digest('hex');
 const owner=await fetch(site+'/admin/archive?id='+turn.conversation_id,{headers:{Cookie:ownerCookie}});
 const html=await owner.text();if(!owner.ok||!html.includes(asset))throw Error('Owner archive missing output');
 console.log(JSON.stringify({verified:true,bytes:bytes.length,mime:job.file.mime,hashMatches:true,otherDevice:other.status,ownerArchive:owner.status}));
}
