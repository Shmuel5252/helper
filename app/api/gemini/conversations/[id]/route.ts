import { deviceOwner, sameOrigin } from '@/lib/archive/identity';
import { conversation } from '@/lib/archive/store';
import { transcript } from '@/lib/archive/service';
import { failure, json } from '@/lib/archive/http';
import { ArchiveError, uuid } from '@/lib/archive/validation';
export const maxDuration=60;
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}) {
  try { const {id}=await params; if(!uuid(id))throw new ArchiveError('שיחה לא נמצאה.',404);
    return json(await transcript(id,await deviceOwner()));
  }catch(e){return failure(e);}
}
export async function DELETE(request:Request,{params}:{params:Promise<{id:string}>}) {
  try {
    sameOrigin(request);
    const {id}=await params;if(!uuid(id))throw new ArchiveError('שיחה לא נמצאה.',404);
    // Device ownership is immutable. Never grant the device access to other chats.
    await conversation(id,await deviceOwner());
    // Old open tabs may still send DELETE. Chat removal must never erase the archive.
    return json({retained:true});
  }catch(e){return failure(e);}
}
