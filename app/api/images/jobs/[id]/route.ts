import {getImageJob,publicImageJob,imageOwner} from '@/lib/realistic-server';
import {json,failure} from '@/lib/archive/http';
import {imageMetadata} from '@/lib/realistic-image';
export async function GET(request:Request,ctx:{params:Promise<{id:string}>}){
  try{
    const job=await getImageJob((await ctx.params).id,await imageOwner(request));
    if(new URL(request.url).searchParams.get('download')==='metadata')return new Response(JSON.stringify(imageMetadata(job),null,2),{headers:{'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="image-${job.id}.json"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
    return json(await publicImageJob(job));
  }catch(e){return failure(e);}
}
