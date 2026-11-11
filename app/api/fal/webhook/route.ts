import {falWebhook} from '@/lib/archive/fal-jobs';
import {uuid} from '@/lib/archive/validation';
import {failure,json} from '@/lib/archive/http';
import {readLimited} from '@/lib/fal';
export const maxDuration=60;
export async function POST(request:Request){
  try{
    const id=new URL(request.url).searchParams.get('turn');
    if(!uuid(id))return new Response(null,{status:400});
    if(!request.headers.has('x-fal-webhook-signature'))return new Response(null,{status:401});
    const bytes=await readLimited(new Response(request.body,{headers:request.headers}),1048576);
    await falWebhook(request.headers,bytes,id);
    return json({ok:true});
  }catch(e){return failure(e);}
}
