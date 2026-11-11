begin;
create or replace function public.archive_browser_update(p_id uuid,p_token uuid,p_action text,p_data jsonb default '{}')
returns boolean language plpgsql set search_path='' as $$
declare j public.archive_browser_jobs; t public.archive_turns; f jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(78121944);
  select * into j from public.archive_browser_jobs where id=p_id for update;
  if not found or j.token is distinct from p_token then return false; end if;
  if j.phase='done' and p_action='complete' then return true; end if;
  if j.phase not in ('claimed','submitted') or j.lease_until<=now() then return false; end if;
  select * into t from public.archive_turns where id=p_id for update;
  if not found or t.status not in ('starting','running') then return false; end if;
  if p_action='renew' then
    update public.archive_browser_jobs set lease_until=now()+interval '90 seconds' where id=p_id;
  elsif p_action='submit' and j.phase='claimed' then
    update public.archive_browser_jobs set phase='submitted' where id=p_id;
  elsif p_action='source' and j.phase='submitted' and (p_data->>'url') ~ '^https://gemini\.google\.com/app/[a-zA-Z0-9_-]+$' then
    update public.archive_browser_jobs set source_url=p_data->>'url' where id=p_id;
  elsif p_action='reserve' and j.phase='submitted' then
    if j.file is not null and j.file<>p_data then raise exception 'output conflict'; end if;
    update public.archive_browser_jobs set file=p_data where id=p_id;
  elsif p_action='complete' and j.phase='submitted' and j.file is not null then
    f:=j.file;
    insert into public.archive_assets(id,conversation_id,name,mime,size)
      values((f->>'id')::uuid,t.conversation_id,f->>'name',f->>'mime',(f->>'size')::bigint);
    update public.archive_turns set status='completed',error=null,checked_at=now(),
      output=(case when coalesce(f->>'text','')='' then '[]'::jsonb else jsonb_build_array(jsonb_build_object('type','text','text',f->>'text')) end)||jsonb_build_array(jsonb_build_object('type',case when f->>'mime'='video/mp4' then 'video' else 'image' end,'assetId',f->>'id')) where id=p_id;
    update public.archive_browser_jobs set phase='done' where id=p_id;
  elsif p_action='fail' then
    update public.archive_turns set status=case when j.phase='submitted' then 'uncertain' else 'failed' end,
      error='Gemini לא השלים את היצירה. אפשר לנסות שוב מאוחר יותר.',checked_at=now() where id=p_id;
    update public.archive_browser_jobs set phase='failed',token=null where id=p_id;
  else return false;
  end if;
  return true;
end $$;

-- Include reserved upload paths, and keep cleanup until all signed upload URLs expire.
create or replace function public.archive_delete_conversation(p_id uuid)
returns text language plpgsql security invoker set search_path='' as $$
declare pending_paths text[];
begin
  perform pg_catalog.pg_advisory_xact_lock(78121944);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text,1));
  perform 1 from public.archive_conversations where id=p_id for update;
  if not found then return 'deleted'; end if;
  if exists(select 1 from public.archive_turns t where conversation_id=p_id and status in ('starting','running') and not exists(select 1 from public.archive_browser_jobs j where j.id=t.id)) then return 'busy'; end if;
  select array_agg(p_id::text||'/'||(j.file->>'id')) into pending_paths from public.archive_browser_jobs j
    join public.archive_turns t on t.id=j.id where t.conversation_id=p_id and j.file is not null;
  insert into public.archive_deletions(id,paths,not_before)
    select p_id,coalesce(array_agg(conversation_id::text||'/'||id::text),'{}'::text[])||coalesce(pending_paths,'{}'::text[]),
      case when pending_paths is null then now() else now()+interval '125 minutes' end
    from public.archive_assets where conversation_id=p_id;
  insert into public.archive_deleted_conversations(id) values(p_id);
  delete from public.archive_turns where conversation_id=p_id;
  delete from public.archive_assets where conversation_id=p_id;
  delete from public.archive_conversations where id=p_id;
  return 'deleted';
end $$;

commit;
