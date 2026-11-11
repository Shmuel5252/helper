import { deviceOwner, sameOrigin } from '@/lib/archive/identity';
import { startTurn } from '@/lib/archive/service';
import { failure, json, smallJson } from '@/lib/archive/http';
import { parseTurn } from '@/lib/archive/validation';
export const maxDuration=60;
export async function POST(request:Request) {
  try { sameOrigin(request); const input=parseTurn(await smallJson(request));
    const turn=await startTurn(await deviceOwner(),input);
    return json({id:turn.id,status:turn.status,error:turn.error});
  }catch(e){return failure(e);}
}
