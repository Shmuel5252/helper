import {getImageJob,imageFile,imageOwner} from '@/lib/realistic-server';
import {failure} from '@/lib/archive/http';
export async function GET(request:Request,ctx:{params:Promise<{id:string}>}){try{return await imageFile(await getImageJob((await ctx.params).id,await imageOwner(request)),new URL(request.url).searchParams.has('download'));}catch(e){return failure(e);}}
