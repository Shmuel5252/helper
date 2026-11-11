import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const db=new PGlite();
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema storage;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
 await db.exec(await readFile('supabase/migrations/202611110001_realistic_images.sql','utf8'));
 const owner='a'.repeat(64),make=()=>({id:randomUUID(),owner,request_hash:'hash',input:'synthetic teapot',settings:{prompt:'teapot',steps:20,guidance_scale:6,seed:42,width:512,height:512}});
 const enqueue=async j=>(await db.query('select public.realistic_enqueue($1::jsonb) as result',[JSON.stringify(j)])).rows[0].result;
 const claim=async token=>(await db.query('select * from public.realistic_claim($1::uuid)',[token])).rows;
 const update=async(id,token,action)=>(await db.query('select public.realistic_update($1::uuid,$2::uuid,$3) as ok',[id,token,action])).rows[0].ok;
 const j={...make(),input:'  צור לי תמונה של חתול 🐈\nליד חלון — בלי לשנות את הבקשה.  '};assert.equal(await enqueue(j),'ok');assert.equal(await enqueue(j),'ok');
 assert.equal(await enqueue({...j,owner:'b'.repeat(64)}),'conflict');
 assert.equal(await enqueue({...j,request_hash:'changed'}),'conflict');
 const token=randomUUID();assert.equal((await claim(token))[0].id,j.id);assert.equal((await claim(randomUUID())).length,0);
 assert.equal(await update(j.id,randomUUID(),'start'),false);assert.equal(await update(j.id,token,'start'),true);
 await db.query("update public.realistic_jobs set lease_until=now()-interval '1 second' where id=$1",[j.id]);
 assert.equal((await claim(randomUUID())).length,0);
 assert.equal((await db.query('select phase from public.realistic_jobs where id=$1',[j.id])).rows[0].phase,'uncertain');
 const stored=(await db.query('select input,settings from public.realistic_jobs where id=$1',[j.id])).rows[0];
 assert.equal(stored.input,j.input);assert.equal(stored.settings.prompt,'teapot');
 for(let i=0;i<3;i++)assert.equal(await enqueue(make()),'ok');assert.equal(await enqueue(make()),'quota');
 await db.exec("update public.realistic_jobs set phase='done';");
 for(let i=0;i<16;i++){assert.equal(await enqueue(make()),'ok');await db.exec("update public.realistic_jobs set phase='done';");}
 assert.equal(await enqueue(make()),'quota');
 assert.equal((await db.query("select public from storage.buckets where id='realistic-images'")).rows[0].public,false);
 for(const role of ['anon','authenticated']){
   await db.exec('set role '+role);
   await assert.rejects(()=>db.query('select * from public.realistic_jobs'),/permission denied/);
   await assert.rejects(()=>db.query('select * from public.realistic_claim($1)',[randomUUID()]),/permission denied/);
   await db.exec('reset role');
 }
 await db.exec('set role service_role');assert.equal((await db.query('select count(*)::int as n from public.realistic_jobs')).rows[0].n,20);
 console.log('PASS actual PostgreSQL migration, private bucket, restricted roles, deduplication, ownership, serial claims, stale lease, queue quota and daily quota');
}finally{await db.close();}
