// Local Supabase + Gemini simulator. Never loads .env.local or contacts Google.
import http from 'node:http';
import fs from 'node:fs';
const tables={archive_conversations:[],archive_turns:[],archive_assets:[],archive_deletions:[],archive_browser_jobs:[]};
const deleted=new Set();let failDelete=false;
const files=new Map(); const jobs=new Map(); let providerReads=0; let calls=0; let seq=0; let failStorage=false;
const now=()=>new Date().toISOString();
const image=fs.readFileSync(new URL('./fixtures/sample.png',import.meta.url)).toString('base64');
const video=fs.readFileSync(new URL('./fixtures/sample.mp4',import.meta.url)).toString('base64');
let delayMs=0;
const reply=(res,status,data,headers={})=>{res.writeHead(status,{'Content-Type':'application/json',...headers});res.end(typeof data==='string'?data:JSON.stringify(data));};
http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost:4040');
    const chunks=[];for await(const c of req)chunks.push(c);const raw=Buffer.concat(chunks);
    const body=raw.length&&req.headers['content-type']?.includes('json')?JSON.parse(raw.toString()):null;
    if(url.pathname==='/control'){
      if(body?.legacy){const x=body.legacy;tables.archive_turns.push({id:x.id,conversation_id:x.conversationId,sequence:++seq,input_hash:'fixture',model_key:x.modelKey,input:'existing fixture',assets:[],status:x.status,provider_id:'legacy-provider-id',output:x.status==='completed'?[{type:'text',text:'saved answer'}]:[],error:null,created_at:now(),checked_at:now()});}

      if(req.method==='POST'){failStorage=body.failStorage??false;if(body.delayMs!==undefined)delayMs=Math.min(60000,Math.max(0,Number(body.delayMs)||0));if(body.dropLatest)jobs.delete(`job-${calls}`);if(body.seed){for(let i=0;i<1001;i++)tables.archive_turns.push({id:crypto.randomUUID(),conversation_id:body.seed,sequence:++seq,input_hash:'seed',model_key:'flash',input:'page '+i,assets:[],status:'completed',provider_id:null,output:[],error:null,created_at:now(),checked_at:now()});}if(body.reset){for(const rows of Object.values(tables))rows.length=0;files.clear();jobs.clear();calls=seq=providerReads=0;delayMs=0;}}
      if(body?.reset){deleted.clear();failDelete=false;}if(body?.failDelete!==undefined)failDelete=body.failDelete;
      return reply(res,200,{calls,providerReads,conversations:tables.archive_conversations.length,turns:tables.archive_turns.length,assets:tables.archive_assets.length,deletions:tables.archive_deletions.length,files:files.size,lastRequest:jobs.get(`job-${calls}`)?.request});
    }
    if(url.pathname.startsWith('/v1beta/interactions')){
      if(req.method==='GET')providerReads++;
      if(req.headers['x-goog-api-key']!=='mock-gemini-key')return reply(res,401,{});
      if(req.method==='POST'){
        calls++; const id=`job-${calls}`; const prompt=JSON.stringify(body.input);
        const content=body.model.includes('omni')?[{type:'video',mime_type:'video/mp4',data:video}]:body.model.includes('image')||body.model.includes('banana')?[{type:'image',mime_type:'image/png',data:image}]:[{type:'text',text:prompt.includes('follow-up')?'זכרתי את ההודעה הקודמת.':'שלום, זו תשובת Gemini לבדיקה.'}];
        jobs.set(id,{id,status:prompt.includes('provider-fail')?'failed':'completed',readyAt:Date.now()+delayMs,steps:[{type:'thought',content:[{type:'text',text:'DO_NOT_SHOW_REASONING'}]},{type:'model_output',content}],request:body});
        if(prompt.includes('ambiguous'))return reply(res,503,{});
        return reply(res,200,{id,status:'in_progress'});
      }
      const id=decodeURIComponent(url.pathname.split('/').at(-1));const job=jobs.get(id);
      if(job&&Date.now()<job.readyAt)return reply(res,200,{id,status:'in_progress'});
      return reply(res,job?200:404,job??{});
    }
    if(req.headers.apikey!=='mock-supabase-secret')return reply(res,401,{});
    if(failStorage)return reply(res,503,{message:'simulated unavailable storage'});
    if(url.pathname==='/rest/v1/archive_browser_health')return reply(res,200,[{id:true,state:'ready',seen_at:now()}]);
    if(url.pathname==='/rest/v1/rpc/archive_browser_enqueue'){
      const c=tables.archive_conversations.find(c=>c.id===body.p_conversation&&c.owner===body.p_owner);
      if(!c)return reply(res,400,{});
      const existing=tables.archive_turns.find(t=>t.id===body.p_id);
      if(existing)return reply(res,200,false);
      if(tables.archive_turns.some(t=>t.conversation_id===c.id&&['starting','running'].includes(t.status)))return reply(res,409,{});
      const id=body.p_id,videoMode=body.p_model==='account-video';
      const turn={id,conversation_id:c.id,sequence:++seq,input_hash:body.p_hash,model_key:body.p_model,input:body.p_input,assets:body.p_assets,status:'running',provider_id:null,output:[],error:null,created_at:now(),checked_at:now()};
      tables.archive_turns.push(turn);tables.archive_browser_jobs.push({id,phase:'submitted'});
      setTimeout(()=>{
        if(body.p_input.includes('refusal')){turn.status='failed';turn.output=[{type:'text',text:'לא ניתן ליצור את הסרטון הזה.'}];return;}
        const asset=crypto.randomUUID(),mime=videoMode?'video/mp4':'image/png',bytes=Buffer.from(videoMode?video:image,'base64');
        tables.archive_assets.push({id:asset,conversation_id:c.id,name:videoMode?'video.mp4':'image.png',mime,size:bytes.length,created_at:now()});
        files.set(`chat-archive/${c.id}/${asset}`,{bytes,mime});turn.status='completed';turn.output=[{type:videoMode?'video':'image',assetId:asset}];
      },2000);
      return reply(res,200,true);
    }
    if(url.pathname==='/rest/v1/rpc/archive_browser_expire')return reply(res,200,null);
    if(url.pathname.startsWith('/storage/v1/object/')){
      const path=url.pathname.slice('/storage/v1/object/'.length);
      if(req.method==='DELETE'){if(failDelete)return reply(res,503,{});for(const p of body.prefixes)files.delete(path+'/'+p);return reply(res,200,[]);}
      if(req.method==='POST'){files.set(path,{bytes:raw,mime:req.headers['content-type']});return reply(res,200,{Key:path});}
      const f=files.get(path);if(!f)return reply(res,404,{});
      let bytes=f.bytes;let status=200;const headers={'Content-Type':f.mime,'Accept-Ranges':'bytes'};
      if(req.headers.range){const match=/bytes=(\d+)-(\d*)/.exec(req.headers.range);if(match){const start=+match[1],end=match[2]?+match[2]:bytes.length-1;headers['Content-Range']=`bytes ${start}-${end}/${bytes.length}`;bytes=bytes.subarray(start,end+1);status=206;}}
      res.writeHead(status,{...headers,'Content-Length':bytes.length});return res.end(req.method==='HEAD'?undefined:bytes);
    }
    if(url.pathname==='/rest/v1/rpc/archive_delete_conversation'){
      const id=body.p_id;
      if(tables.archive_turns.some(t=>t.conversation_id===id&&['starting','running'].includes(t.status)))return reply(res,200,JSON.stringify('busy'));
      if(!deleted.has(id)){
        tables.archive_deletions.push({id,paths:tables.archive_assets.filter(a=>a.conversation_id===id).map(a=>id+'/'+a.id),created_at:now()});deleted.add(id);
        for(const name of ['archive_turns','archive_assets','archive_conversations'])tables[name]=tables[name].filter(r=>name==='archive_conversations'?r.id!==id:r.conversation_id!==id);
      }
      return reply(res,200,JSON.stringify('deleted'));
    }
    if(url.pathname==='/rest/v1/rpc/archive_begin_turn'){
      const c=tables.archive_conversations.find(c=>c.id===body.p_conversation&&c.owner===body.p_owner);
      if(!c)return reply(res,400,{});
      const existing=tables.archive_turns.find(t=>t.id===body.p_id);
      if(existing)return reply(res,existing.conversation_id===body.p_conversation&&existing.input_hash===body.p_hash?200:409,false);
      if(tables.archive_turns.some(t=>t.conversation_id===c.id&&['starting','running'].includes(t.status)))return reply(res,409,{});
      if(body.p_assets.some(id=>!tables.archive_assets.some(a=>a.id===id&&a.conversation_id===c.id)))return reply(res,400,{});
      tables.archive_turns.push({id:body.p_id,conversation_id:c.id,sequence:++seq,input_hash:body.p_hash,model_key:body.p_model,input:body.p_input,assets:body.p_assets,status:'starting',provider_id:null,output:[],error:null,created_at:now(),checked_at:now()});c.updated_at=now();
      return reply(res,200,true);
    }
    const name=url.pathname.split('/').at(-1);const rows=tables[name];if(!rows)return reply(res,404,{});
    if(req.method==='POST'&&name==='archive_conversations'&&deleted.has(body.id))return reply(res,409,{});
    const matches=row=>[...url.searchParams].every(([key,value])=>{
      if(['select','order','limit','offset','on_conflict'].includes(key))return true;
      if(value.startsWith('eq.'))return String(row[key])===value.slice(3);
      if(value.startsWith('lt.'))return row[key]<value.slice(3);
      if(value.startsWith('ilike.'))return String(row[key]).toLowerCase().includes(value.slice(7,-1).toLowerCase());
      if(value.startsWith('in.('))return value.slice(4,-1).split(',').includes(row[key]);return true;
    });
    if(req.method==='GET'){let found=rows.filter(matches);const order=url.searchParams.get('order');if(order){const [key,dir]=order.split('.');found.sort((a,b)=>(a[key]<b[key]?-1:a[key]>b[key]?1:0)*(dir==='desc'?-1:1));}const offset=Number(url.searchParams.get('offset')??0);found=found.slice(offset,offset+Number(url.searchParams.get('limit')??1000));return reply(res,200,found);}
    if(req.method==='PATCH'){const found=rows.filter(matches);for(const row of found)Object.assign(row,body);return reply(res,200,found);}
    if(req.method==='DELETE'){tables[name]=rows.filter(r=>!matches(r));return reply(res,200,[]);}
    if(req.method==='POST'){const existing=rows.find(r=>r.id===body.id);if(existing){if(req.headers.prefer?.includes('merge-duplicates'))Object.assign(existing,body);else if(!req.headers.prefer?.includes('ignore-duplicates'))return reply(res,409,{});}else rows.push({created_at:now(),updated_at:now(),...body});return reply(res,201,[existing??rows.at(-1)]);}
    return reply(res,405,{});
  }catch(e){console.error(e.message);reply(res,500,{});}
}).listen(4040,()=>console.log('Archive simulator on :4040'));
