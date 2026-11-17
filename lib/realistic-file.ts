import {ArchiveError} from './archive/validation.ts';
import {validMedia} from './archive/worker-contract.ts';

const MAX_IMAGE_BYTES=2_000_000; // Same limit enforced when the image worker uploads.
type StorageRequest=(path:string,init:RequestInit)=>Promise<Response>;
const unavailable=()=>new ArchiveError('התמונה לא זמינה.',503);

// The authorized route supplies the private object path. Storage URLs and credentials
// stay on the server; a storage redirect must never be followed with its API key.
export async function storedImageFile(path:string,headers:HeadersInit,storage:StorageRequest):Promise<Response>{
  const upstream=await storage(path,{redirect:'error',cache:'no-store'});
  if(upstream.status!==200||upstream.redirected||!upstream.body||Number(upstream.headers.get('content-length'))>MAX_IMAGE_BYTES){
    await upstream.body?.cancel().catch(()=>{});
    throw unavailable();
  }
  const reader=upstream.body.getReader();
  const chunks:Uint8Array[]=[];let size=0;
  try{
    for(;;){
      const {value,done}=await reader.read();if(done)break;
      size+=value.length;if(size>MAX_IMAGE_BYTES)throw unavailable();
      chunks.push(value);
    }
  }finally{await reader.cancel().catch(()=>{});}
  const bytes=Buffer.concat(chunks);
  if(!validMedia(bytes,'image/png'))throw unavailable();
  return new Response(bytes,{headers});
}
