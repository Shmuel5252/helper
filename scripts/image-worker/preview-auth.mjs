// Deployment-scoped Preview access. Never forward this cookie to Storage or the model.
export function previewAccess(origin,env=process.env){
  let cookie,expires=0;
  return async()=>{
    if(env.IMAGE_PREVIEW_BYPASS)return {'x-vercel-protection-bypass':env.IMAGE_PREVIEW_BYPASS};
    if(env.IMAGE_PREVIEW_SHARE){
      if(!cookie||Date.now()>=expires){
        const url=new URL('/',origin);url.searchParams.set('_vercel_share',env.IMAGE_PREVIEW_SHARE);
        const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(20000)});
        const entry=response.headers.getSetCookie().find(v=>v.startsWith('_vercel_jwt='));
        if(!entry||![302,303,307,308].includes(response.status))throw Error('Preview authorization expired or unavailable');
        cookie=entry.split(';')[0];expires=Date.now()+15*60*1000;
      }
      return {Cookie:cookie};
    }
    return {};
  };
}
