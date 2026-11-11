import http from 'node:http';
import fs from 'node:fs';
import {randomUUID,generateKeyPairSync,createHash,sign} from 'node:crypto';
const jobs=new Map();let calls=0;let lastInput=null;
const {privateKey,publicKey}=generateKeyPairSync('ed25519');
const reply=(r,s,x)=>{r.writeHead(s,{'Content-Type':'application/json'});r.end(JSON.stringify(x));};
http.createServer(async(req,res)=>{
  try{
    const chunks=[];for await(const c of req)chunks.push(c);const raw=Buffer.concat(chunks);const data=raw.length?JSON.parse(raw):null;
    if(req.url==='/control')return reply(res,200,{calls,lastInput});
    if(req.url==='/callback'){
      const job=jobs.get(data.requestId);const body=JSON.stringify({request_id:data.requestId,status:'OK'});const ts=String(Math.floor(Date.now()/1000));
      const message=[data.requestId,'test-account',ts,createHash('sha256').update(body).digest('hex')].join('\n');
      const hook=new URL(job.hook);const target='http://localhost:3116'+hook.pathname+hook.search;
      const r=await fetch(target,{method:'POST',headers:{'Content-Type':'application/json','x-fal-webhook-request-id':data.requestId,'x-fal-webhook-user-id':'test-account','x-fal-webhook-timestamp':ts,'x-fal-webhook-signature':sign(null,Buffer.from(message),privateKey).toString('hex')},body});
      return reply(res,200,{status:r.status});
    }
    const url=new URL(req.headers['x-mock-original-url']);
    if(url.hostname==='rest.fal.ai')return reply(res,200,{keys:[publicKey.export({format:'jwk'})]});
    if(url.hostname==='v3b.fal.media'){
      if(req.headers.authorization)throw Error('Credential leaked to media host');
      const video=url.pathname.endsWith('.mp4');const file=fs.readFileSync(new URL(video?'./fixtures/sample.mp4':'./fixtures/sample.png',import.meta.url));
      res.writeHead(200,{'Content-Type':video?'video/mp4':'image/png'});return res.end(file);
    }
    if(req.headers.authorization!=='Key isolated-fal-key')return reply(res,401,{});
    if(req.method==='POST'){
      calls++;lastInput={endpoint:url.pathname,input:data};
      if(data.prompt==='no-credits')return reply(res,403,{detail:'User is locked. Exhausted balance.'});
      const id=randomUUID(),endpoint=url.pathname.slice(1),base=`https://queue.fal.run/${endpoint.split('/').slice(0,2).join('/')}/requests/${id}`;
      jobs.set(id,{kind:endpoint.includes('video')?'video':'image',prompt:data.prompt,hook:url.searchParams.get('fal_webhook')});
      if(data.prompt==='ambiguous')return reply(res,503,{});
      return reply(res,200,{request_id:id,response_url:base,status_url:base+'/status'});
    }
    const id=url.pathname.split('/requests/')[1]?.split('/')[0],job=jobs.get(id);
    if(!job)return reply(res,404,{});
    if(url.pathname.endsWith('/status'))return reply(res,200,{status:'COMPLETED',...(job.prompt==='refusal'?{error:'content_policy_violation'}:{})});
    return reply(res,200,job.kind==='video'?{video:{url:'https://v3b.fal.media/result.mp4',content_type:'video/mp4'}}:{images:[{url:'https://v3b.fal.media/result.png',content_type:'image/png'}]});
  }catch(e){console.error(e.message);reply(res,500,{});}
}).listen(4042,()=>console.log('Isolated fal provider :4042'));
