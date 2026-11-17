import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer, type Server} from 'node:http';
import {once} from 'node:events';
import {storedImageFile} from './realistic-file.ts';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9N8AAAAASUVORK5CYII=','base64');
const path='/storage/v1/object/realistic-images/owner/test.png';
const headers={
  'Cache-Control':'private, no-store','Content-Type':'image/png',
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
  'Content-Disposition':'inline; filename="image-test.png"',
};
const unavailable=(error:unknown)=>error instanceof Error&&'status' in error&&error.status===503;

test('stored images return PNG bytes on the app response without storage URLs or headers',async()=>{
  let requested='';let options:RequestInit|undefined;
  const response=await storedImageFile(path,headers,async(p,init)=>{
    requested=p;options=init;
    return new Response(png,{headers:{'Set-Cookie':'storage-only=private','X-Storage-Token':'private'}});
  });
  assert.equal(requested,path);
  assert.equal(options?.redirect,'error');
  assert.equal(response.status,200);
  assert.equal(response.headers.get('Location'),null);
  assert.equal(response.headers.get('Set-Cookie'),null);
  assert.equal(response.headers.get('X-Storage-Token'),null);
  for(const [key,value] of Object.entries(headers))assert.equal(response.headers.get(key),value);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),png);
});

test('download keeps the app attachment header',async()=>{
  const response=await storedImageFile(path,{...headers,'Content-Disposition':'attachment; filename="image-test.png"'},async()=>new Response(png));
  assert.equal(response.headers.get('Content-Disposition'),'attachment; filename="image-test.png"');
  assert.equal(response.headers.get('Location'),null);
});

async function listening(server:Server){
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address();assert.ok(address&&typeof address!=='string');
  return `http://127.0.0.1:${address.port}`;
}
async function close(server:Server){
  await new Promise<void>((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();});
}

test('a storage redirect cannot forward the storage credential or expose a redirect to the phone',async()=>{
  let redirectedRequests=0;let authenticatedStorageRequests=0;
  const other=createServer((_request,response)=>{redirectedRequests++;response.end(png);});
  const otherOrigin=await listening(other);
  const storage=createServer((request,response)=>{
    if(request.headers.apikey==='storage-test-key')authenticatedStorageRequests++;
    response.writeHead(302,{Location:otherOrigin+'/private.png'});response.end();
  });
  try{
    const origin=await listening(storage);
    await assert.rejects(storedImageFile(path,headers,(p,init)=>fetch(origin+p,{
      ...init,headers:{apikey:'storage-test-key'},signal:AbortSignal.timeout(3000),
    })));
    assert.equal(authenticatedStorageRequests,1);
    assert.equal(redirectedRequests,0);
  }finally{await close(storage);await close(other);}
});

test('unexpected redirect responses are rejected even when a storage adapter returns one',async()=>{
  await assert.rejects(storedImageFile(path,headers,async()=>new Response(null,{status:302,headers:{Location:'https://storage.example/private.png'}})),unavailable);
});

test('storage error pages are never served as images',async()=>{
  await assert.rejects(storedImageFile(path,headers,async()=>new Response('<html>not a PNG</html>')),unavailable);
  await assert.rejects(storedImageFile(path,headers,async()=>new Response(png,{status:503})),unavailable);
});

test('oversized declared image bodies are cancelled before reading',async()=>{
  let cancelled=false;
  const body=new ReadableStream<Uint8Array>({cancel(){cancelled=true;}});
  await assert.rejects(storedImageFile(path,headers,async()=>new Response(body,{headers:{'Content-Length':'2000001'}})),unavailable);
  assert.equal(cancelled,true);
});

test('the image size limit also applies without a content length',async()=>{
  let cancelled=false;
  const body=new ReadableStream<Uint8Array>({
    start(controller){controller.enqueue(png);controller.enqueue(new Uint8Array(2_000_000));},
    cancel(){cancelled=true;},
  });
  await assert.rejects(storedImageFile(path,headers,async()=>new Response(body)),unavailable);
  assert.equal(cancelled,true);
});
