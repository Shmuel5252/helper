-- Apply only after cloud privacy/storage approval. Does not change existing chat tables.
begin;
create table public.realistic_health (
  id boolean primary key default true check(id),
  state text not null check(state in ('ready','busy','offline')),
  seen_at timestamptz not null default now()
);
create table public.realistic_jobs (
  id uuid primary key, owner text not null check(owner ~ '^[a-f0-9]{64}$'),
  request_hash text not null, input text not null check(length(input)<=4000), settings jsonb not null,
  phase text not null default 'queued' check(phase in ('queued','claimed','generating','done','failed','uncertain')),
  token uuid, lease_until timestamptz, not_before timestamptz, error text, image_id text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index realistic_owner_created on public.realistic_jobs(owner,created_at);
create index realistic_queue on public.realistic_jobs(created_at) where phase='queued';
alter table public.realistic_jobs enable row level security;
alter table public.realistic_health enable row level security;
revoke all on public.realistic_jobs,public.realistic_health from public,anon,authenticated;
grant select,insert,update,delete on public.realistic_jobs,public.realistic_health to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('realistic-images','realistic-images',false,2000000,array['image/png'])
  on conflict(id) do update set public=false,file_size_limit=2000000,allowed_mime_types=array['image/png'];

create function public.realistic_enqueue(p_job jsonb) returns text language plpgsql set search_path='' as $$
declare old public.realistic_jobs; own text:=p_job->>'owner';
begin
  perform pg_catalog.pg_advisory_xact_lock(78121955);
  select * into old from public.realistic_jobs where id=(p_job->>'id')::uuid;
  if found then
    if old.owner=own and old.request_hash=p_job->>'request_hash' then return 'ok'; else return 'conflict'; end if;
  end if;
  if (select count(*) from public.realistic_jobs where owner=own and created_at>now()-interval '24 hours')>=20
    or (select count(*) from public.realistic_jobs where created_at>now()-interval '24 hours')>=100
    or (select count(*) from public.realistic_jobs where owner=own and phase in ('queued','claimed','generating'))>=3
    or (select count(*) from public.realistic_jobs where phase in ('queued','claimed','generating'))>=50 then return 'quota'; end if;
  insert into public.realistic_jobs(id,owner,request_hash,input,settings)
    values((p_job->>'id')::uuid,own,p_job->>'request_hash',p_job->>'input',p_job->'settings');
  return 'ok';
end $$;

create function public.realistic_claim(p_token uuid) returns setof public.realistic_jobs language plpgsql set search_path='' as $$
declare job_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(78121955);
  -- After a possible POST /generate, never regenerate automatically. Before POST, retry is safe.
  update public.realistic_jobs set phase=case when phase='generating' then 'uncertain' else 'queued' end,token=null,updated_at=now()
    where phase in ('claimed','generating') and lease_until<=now();
  update public.realistic_jobs set phase='failed',error='הבקשה פגה לאחר שבעה ימים בתור.',updated_at=now()
    where phase='queued' and created_at<now()-interval '7 days';
  if exists(select 1 from public.realistic_jobs where phase in ('claimed','generating')) then return; end if;
  select id into job_id from public.realistic_jobs where phase='queued' and (not_before is null or not_before<=now()) order by created_at,id limit 1 for update;
  if job_id is null then return; end if;
  return query update public.realistic_jobs set phase='claimed',token=p_token,lease_until=now()+interval '10 minutes',updated_at=now() where id=job_id returning *;
end $$;

create function public.realistic_update(p_id uuid,p_token uuid,p_action text,p_data jsonb default '{}') returns boolean language plpgsql set search_path='' as $$
declare j public.realistic_jobs;
begin
  perform pg_catalog.pg_advisory_xact_lock(78121955);
  select * into j from public.realistic_jobs where id=p_id for update;
  if not found or j.token is distinct from p_token then return false; end if;
  if j.phase='done' and p_action='complete' then return true; end if;
  if j.phase not in ('claimed','generating') or j.lease_until<=now() then return false; end if;
  if p_action='renew' then update public.realistic_jobs set lease_until=now()+interval '10 minutes' where id=p_id;
  elsif p_action='start' and j.phase='claimed' then update public.realistic_jobs set phase='generating' where id=p_id;
  elsif p_action='defer' then update public.realistic_jobs set phase='queued',token=null,not_before=now()+interval '5 seconds' where id=p_id;
  elsif p_action='complete' and j.phase='generating' then update public.realistic_jobs set phase='done',image_id=p_data->>'image_id' where id=p_id;
  elsif p_action='fail' then update public.realistic_jobs set phase=case when phase='generating' then 'uncertain' else 'failed' end,error=p_data->>'error' where id=p_id;
  else return false;
  end if;
  update public.realistic_jobs set updated_at=now() where id=p_id;
  return true;
end $$;
revoke all on function public.realistic_enqueue(jsonb),public.realistic_claim(uuid),public.realistic_update(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.realistic_enqueue(jsonb),public.realistic_claim(uuid),public.realistic_update(uuid,uuid,text,jsonb) to service_role;
commit;
