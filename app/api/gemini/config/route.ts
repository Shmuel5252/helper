import { connection } from 'next/server';
import { archiveConfigured, db } from '@/lib/archive/store';
import { ARCHIVE_MODELS } from '@/lib/archive/validation';
import { json } from '@/lib/archive/http';
import { browserHealth } from '@/lib/archive/browser-jobs';
import {falReady,falSelected} from '@/lib/archive/fal-jobs';
export async function GET() {
  await connection();
  if(falSelected())return json({available:archiveConfigured()&&falReady(),models:ARCHIVE_MODELS.filter(m=>m.provider==='fal').map(({key,label,kind,provider})=>({key,label,kind,provider}))});
  const health=await browserHealth();
  let available=archiveConfigured() && health.ready;
  if(available)try{await db('archive_conversations','select=id&limit=0');}catch{available=false;}
  return json({available,models:ARCHIVE_MODELS.filter(m=>health.ready&&m.provider==='account').map(({key,label,kind,provider})=>({key,label,kind,provider}))});
}
