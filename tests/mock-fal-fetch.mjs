// Loaded ONLY in the isolated test app. External requests fail closed.
const realFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
  if(['queue.fal.run','rest.fal.ai','v3b.fal.media'].includes(url.hostname)){
    const headers=new Headers(init?.headers);headers.set('x-mock-original-url',url.href);
    return realFetch('http://127.0.0.1:4042/proxy',{...init,headers});
  }
  if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('External network forbidden in isolated fal test');
  return realFetch(input,init);
};
