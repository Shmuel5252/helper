import {imageOwner,getImageJob} from '@/lib/realistic-server';
import {archiveOwnedImage} from '@/lib/realistic-archive';
import {json,failure,smallJson} from '@/lib/archive/http';
import {uuid,ArchiveError} from '@/lib/archive/validation';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const owner=await imageOwner(request),body=await smallJson(request);
    if(!uuid(body.conversationId))throw new ArchiveError('שיחה לא תקינה.');
    await archiveOwnedImage(await getImageJob((await params).id,owner),body.conversationId);
    return json({ok:true});
  }catch(e){return failure(e);}
}
