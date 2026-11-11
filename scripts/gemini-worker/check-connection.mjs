process.loadEnvFile('/etc/ai-chat-gemini-worker.env');
for(let i=0;i<3;i++){
 const start=Date.now();
 try{
  const r=await fetch(new URL('/api/worker/gemini',process.env.APP_ORIGIN),{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.GEMINI_WORKER_SECRET}`},body:JSON.stringify({action:'heartbeat',state:'ready'}),signal:AbortSignal.timeout(35000)});
  await r.text();console.log(JSON.stringify({status:r.status,ms:Date.now()-start}));
 }catch(e){console.log(JSON.stringify({error:e.name,cause:e.cause?.code,ms:Date.now()-start}));}
}
