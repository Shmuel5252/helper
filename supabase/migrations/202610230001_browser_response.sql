begin;
-- Only a current, submitted claim may finish with provider text instead of media.
-- Defining this function does not modify any existing conversation.
create or replace function public.archive_browser_response(p_id uuid,p_token uuid,p_text text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare j public.archive_browser_jobs; t public.archive_turns; result jsonb;
begin
  if p_text is null or length(trim(p_text))=0 or length(p_text)>8000 then return false; end if;
  perform pg_catalog.pg_advisory_xact_lock(78121944);
  select * into j from public.archive_browser_jobs where id=p_id for update;
  if not found or j.token is distinct from p_token or p_token is null then return false; end if;
  select * into t from public.archive_turns where id=p_id for update;
  if not found then return false; end if;
  result:=jsonb_build_array(jsonb_build_object('type','text','text',p_text));
  if j.phase='done' and t.status='failed' and t.output=result then return true; end if;
  if j.phase<>'submitted' or j.lease_until is null or j.lease_until<=now() or j.file is not null or t.status not in ('starting','running') then return false; end if;
  update public.archive_turns set status='failed',output=result,error=null,checked_at=now() where id=p_id;
  update public.archive_browser_jobs set phase='done' where id=p_id;
  return true;
end $$;
revoke all on function public.archive_browser_response(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.archive_browser_response(uuid,uuid,text) to service_role;
commit;
