begin;
-- Explicit owner maintenance only. Reopens a download from an already recorded
-- Gemini source; the worker's source branch must never prepare or send a prompt.
create function public.archive_browser_recover(p_id uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare j public.archive_browser_jobs; t public.archive_turns;
begin
  perform public.archive_browser_expire();
  select * into j from public.archive_browser_jobs where id=p_id for update;
  if not found or j.phase<>'failed' or j.file is not null or j.source_url is null
    or j.source_url !~ '^https://gemini\.google\.com/app/[a-zA-Z0-9_-]+$' then return false; end if;
  select * into t from public.archive_turns where id=p_id for update;
  if not found or t.status not in ('uncertain','failed') then return false; end if;
  if exists(select 1 from public.archive_turns where conversation_id=t.conversation_id and status in ('starting','running')) then return false; end if;
  update public.archive_turns set status='starting',error=null,checked_at=now() where id=p_id;
  update public.archive_browser_jobs set phase='queued',token=null,lease_until=null,created_at=now() where id=p_id;
  return true;
end $$;
revoke all on function public.archive_browser_recover(uuid) from public,anon,authenticated;
grant execute on function public.archive_browser_recover(uuid) to service_role;
commit;
