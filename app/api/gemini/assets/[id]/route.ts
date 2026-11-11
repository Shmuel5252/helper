import { admin, deviceOwner } from '@/lib/archive/identity';
import { assetPath, BUCKET, conversation, db, supabase } from '@/lib/archive/store';
import { failure } from '@/lib/archive/http';
import { ArchiveError, uuid } from '@/lib/archive/validation';
import type { ArchiveAsset } from '@/lib/archive/types';
export const maxDuration=60;
async function serve(request:Request,params:Promise<{id:string}>) {
  try {
    const {id}=await params;if(!uuid(id))throw new ArchiveError('קובץ לא נמצא.',404);
    const assets=await db<ArchiveAsset[]>('archive_assets',`id=eq.${id}&limit=1`); const asset=assets[0];
    if(!asset)throw new ArchiveError('קובץ לא נמצא.',404);
    const isAdmin=await admin(); await conversation(asset.conversation_id,isAdmin?undefined:await deviceOwner());
    const range=request.headers.get('range');
    if(range && !/^bytes=\d*-\d*$/.test(range))return new Response(null,{status:416});
    const upstream=await supabase(`/storage/v1/object/${BUCKET}/${assetPath(asset)}`,{method:request.method,headers:range?{Range:range}:{}});
    const inline=/^(image\/(png|jpeg|webp)|video\/mp4)$/.test(asset.mime) && !new URL(request.url).searchParams.has('download');
    const headers=new Headers({'Content-Type':asset.mime,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',
      'Content-Security-Policy':"default-src 'none'; sandbox",'Content-Disposition':`${inline?'inline':'attachment'}; filename="file"; filename*=UTF-8''${encodeURIComponent(asset.name)}`});
    for(const key of ['content-length','content-range','accept-ranges']){const value=upstream.headers.get(key);if(value)headers.set(key,value);}
    return new Response(request.method==='HEAD'?null:upstream.body,{status:upstream.status,headers});
  }catch(e){return failure(e);}
}
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){return serve(request,params);}
export async function HEAD(request:Request,{params}:{params:Promise<{id:string}>}){return serve(request,params);}
