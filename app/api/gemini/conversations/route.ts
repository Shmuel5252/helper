import { deviceOwner, sameOrigin } from '@/lib/archive/identity';
import { conversation, db } from '@/lib/archive/store';
import { failure, json, smallJson } from '@/lib/archive/http';
import { ArchiveError, uuid } from '@/lib/archive/validation';
import type { ArchiveConversation } from '@/lib/archive/types';
export async function POST(request:Request) {
  try {
    sameOrigin(request);
    const body=await smallJson(request);
    if(!uuid(body.id)||typeof body.title!=='string'||!body.title.trim())throw new ArchiveError('שיחה לא תקינה.');
    const owner=await deviceOwner(true);
    // Ignore duplicate insertion, then check actual owner; never overwrite another browser.
    await db<ArchiveConversation[]>('archive_conversations','on_conflict=id','POST',{
      id:body.id,owner,title:body.title.trim().slice(0,120),
    },'resolution=ignore-duplicates,return=minimal');
    const c=await conversation(body.id,owner);
    return json({id:c.id,title:c.title});
  }catch(e){return failure(e);}
}
