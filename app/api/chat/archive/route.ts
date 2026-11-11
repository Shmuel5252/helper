import {deviceOwner,sameOrigin} from '@/lib/archive/identity';
import {failure,json} from '@/lib/archive/http';
import {ArchiveError} from '@/lib/archive/validation';
import {preserveLocalTurn} from '@/lib/archive/chat';
export async function POST(request:Request){
  try{sameOrigin(request);const raw=await request.text();if(raw.length>130000)throw new ArchiveError('הבקשה גדולה מדי.',413);
    await preserveLocalTurn(await deviceOwner(),JSON.parse(raw));return json({saved:true});
  }catch(e){return failure(e);}
}
