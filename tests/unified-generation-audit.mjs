// Read-only audit of an explicitly authorized new test conversation.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
process.loadEnvFile('.env.local');
const base=process.env.SUPABASE_URL,headers={apikey:process.env.SUPABASE_SECRET_KEY};
async function read(table,query=''){
  const all=[];
  for(let offset=0;;offset+=200){
    const r=await fetch(`${base}/rest/v1/${table}?${query}&order=id.asc&limit=200&offset=${offset}`,{headers});
    if(!r.ok)throw Error('Read failed '+r.status);
    const rows=await r.json();all.push(...rows);if(rows.length<200)return all;
  }
}
const file='test-screenshots/unified-generation-baseline.json';
const tables=['archive_conversations','archive_turns','archive_assets'];
const hash=row=>createHash('sha256').update(JSON.stringify(row)).digest('hex');
if(process.argv[2]==='baseline'){
  const snapshot={};for(const table of tables)snapshot[table]=Object.fromEntries((await read(table)).map(row=>[row.id,hash(row)]));
  fs.writeFileSync(file,JSON.stringify(snapshot));
  console.log(JSON.stringify({baseline:Object.fromEntries(tables.map(t=>[t,Object.keys(snapshot[t]).length]))}));
}else{
  const baseline=JSON.parse(fs.readFileSync(file,'utf8'));const newRows={};const changed=[];
  for(const table of tables){const rows=await read(table);const map=new Map(rows.map(r=>[r.id,r]));for(const[id,digest]of Object.entries(baseline[table]))if(!map.has(id)||hash(map.get(id))!==digest)changed.push({table,id});newRows[table]=rows.filter(r=>!baseline[table][r.id]);}
  const test=newRows.archive_conversations.find(c=>c.title.startsWith('בדיקת חיבור מאוחדת 11.11'));
  const turns=newRows.archive_turns.filter(t=>t.conversation_id===test?.id);
  const assets=newRows.archive_assets.filter(a=>a.conversation_id===test?.id);
  const report={existingRecordsUnchanged:changed.length===0,changed,testConversation:test?.id,turns:turns.map(t=>({id:t.id,model:t.model_key,status:t.status,input:t.input,output:t.output,error:t.error})),assets:assets.map(a=>({id:a.id,mime:a.mime,size:a.size}))};
  if(process.argv.includes('--files'))for(const a of assets){const r=await fetch(`${base}/storage/v1/object/chat-archive/${test.id}/${a.id}`,{headers});const b=Buffer.from(await r.arrayBuffer());report.assets.find(x=>x.id===a.id).readable=r.ok&&b.length===a.size;}
  fs.writeFileSync('test-screenshots/unified-generation-report.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}
