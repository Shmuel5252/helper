import { workerAuthorized } from '@/lib/archive/worker-contract';
import { workerOperation } from '@/lib/archive/browser-jobs';
import { failure, json, smallJson } from '@/lib/archive/http';
export const maxDuration=60;
export async function POST(request:Request){
  if(!workerAuthorized(request.headers.get('authorization'),process.env.GEMINI_WORKER_SECRET))return json({error:'Unauthorized'},401);
  try{return json(await workerOperation(await smallJson(request)));}catch(e){return failure(e);}
}
