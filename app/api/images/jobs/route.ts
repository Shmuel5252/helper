import {enqueueImage,imageOwner} from '@/lib/realistic-server';
import {json,failure,smallJson} from '@/lib/archive/http';
export const maxDuration=60;
export async function POST(request:Request){try{return json(await enqueueImage(await imageOwner(request,true),await smallJson(request)));}catch(e){return failure(e);}}
