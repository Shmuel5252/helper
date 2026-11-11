import { deviceOwner, sameOrigin } from '@/lib/archive/identity';
import { conversation } from '@/lib/archive/store';
import { findTurn, refreshTurn } from '@/lib/archive/service';
import { failure, json } from '@/lib/archive/http';
import { ArchiveError, uuid } from '@/lib/archive/validation';
export const maxDuration=60;
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
  try { sameOrigin(request); const {id}=await params; if(!uuid(id))throw new ArchiveError('בקשה לא נמצאה.',404);
    const turn=await findTurn(id); await conversation(turn.conversation_id,await deviceOwner());
    const updated=await refreshTurn(turn);
    return json({id:updated.id,status:updated.status,error:updated.error});
  }catch(e){return failure(e);}
}
