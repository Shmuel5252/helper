import {imageHealth,authorizeImageRequest} from '@/lib/realistic-server';
import {json,failure} from '@/lib/archive/http';
export async function GET(request:Request){try{await authorizeImageRequest(request);return json(await imageHealth());}catch(e){return failure(e);}}
