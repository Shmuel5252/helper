import {imageWorkerOperation} from '@/lib/realistic-server';
import {workerAuthorized} from '@/lib/archive/worker-contract';
import {failure,json} from '@/lib/archive/http';
export const maxDuration=60;
export async function POST(request:Request){
  if(!workerAuthorized(request.headers.get('authorization'),process.env.IMAGE_WORKER_SECRET))return json({error:'Unauthorized'},401);
  try{
    const raw=await request.text();if(raw.length>2900000)return json({error:'Too large'},413);
    return json(await imageWorkerOperation(JSON.parse(raw)));
  }catch(e){return failure(e);}
}
