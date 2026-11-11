import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const origin='http://127.0.0.1:7860';
const before=await(await fetch(origin+'/health')).json();
assert.equal(before.image_to_image,true);
const body={prompt:'A red ceramic mug on a wooden table beside a window, soft morning light, small green plant in the background, realistic photograph',negative_prompt:'text, watermark, blurry',width:512,height:512,steps:20,guidance_scale:6,seed:251111,strength:0.65,image_base64:(await readFile('.local-images/production-test/remote-image.png')).toString('base64')};
let response;
for(let n=0;n<60;n++){
  const status=await(await fetch(origin+'/health')).json();
  if(status.active_jobs){await new Promise(r=>setTimeout(r,4000));continue;}
  response=await fetch(origin+'/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(330000)});
  if(response.status!==429)break;
  await response.text();await new Promise(r=>setTimeout(r,4000));
}
assert.ok(response,'Model remained busy');
assert.equal(response.status,200,'Local image edit should succeed');
const result=await response.json();assert.equal(result.mode,'image-to-image');
const png=Buffer.from(await(await fetch(origin+result.image_url)).arrayBuffer());
assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
await mkdir('.local-images/edit-test',{recursive:true});await writeFile('.local-images/edit-test/local-edit.png',png);
const health=await(await fetch(origin+'/health')).json();assert.equal(health.model_load_count,1);
const evidence={mode:result.mode,id:result.id,seed:result.seed,seconds:result.seconds,modelLoadCount:health.model_load_count,sharedComponents:health.shared_model_components,bytes:png.length};
await writeFile('.local-images/edit-test/local-verified.json',JSON.stringify(evidence,null,2));console.log(evidence);
