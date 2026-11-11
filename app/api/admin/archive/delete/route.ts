import { requireAdmin } from '@/lib/openart/admin';
import { sameOrigin } from '@/lib/archive/identity';
import { deleteConversation } from '@/lib/archive/delete';
import { failure, json, smallJson } from '@/lib/archive/http';
import { ArchiveError, uuid } from '@/lib/archive/validation';
export const maxDuration=60;
export async function POST(request:Request){
  const denied=await requireAdmin();if(denied)return denied;
  try{
    sameOrigin(request);
    const body=await smallJson(request);
    if(!uuid(body?.id))throw new ArchiveError('השיחה אינה תקינה.',400);
    await deleteConversation(body.id);
    return json({deleted:true});
  }catch(e){return failure(e);}
}
