begin;
-- Only IDs are retained to prevent stale browser tabs recreating deleted chats.
create table if not exists public.archive_deleted_conversations (id uuid primary key);
create table if not exists public.archive_deletions (
  id uuid primary key,
  paths text[] not null,
  created_at timestamptz not null default now()
);
alter table public.archive_deleted_conversations enable row level security;
alter table public.archive_deletions enable row level security;
revoke all on public.archive_deleted_conversations, public.archive_deletions from anon, authenticated;
grant select, insert, delete on public.archive_deleted_conversations, public.archive_deletions to service_role;

create or replace function public.archive_prevent_recreation()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.id::text, 1));
  if exists(select 1 from public.archive_deleted_conversations where id=new.id) then
    raise exception 'conversation deleted' using errcode='23505';
  end if;
  return new;
end $$;
drop trigger if exists archive_no_recreation on public.archive_conversations;
create trigger archive_no_recreation before insert on public.archive_conversations
for each row execute function public.archive_prevent_recreation();

create or replace function public.archive_delete_conversation(p_id uuid)
returns text language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text, 1));
  perform 1 from public.archive_conversations where id=p_id for update;
  if not found then return 'deleted'; end if;
  if exists(select 1 from public.archive_turns where conversation_id=p_id and status in ('starting','running')) then
    return 'busy';
  end if;
  insert into public.archive_deletions(id, paths)
    select p_id, coalesce(array_agg(conversation_id::text || '/' || id::text), '{}'::text[])
    from public.archive_assets where conversation_id=p_id;
  insert into public.archive_deleted_conversations(id) values(p_id);
  delete from public.archive_turns where conversation_id=p_id;
  delete from public.archive_assets where conversation_id=p_id;
  delete from public.archive_conversations where id=p_id;
  return 'deleted';
end $$;
revoke all on function public.archive_prevent_recreation() from public, anon, authenticated;
revoke all on function public.archive_delete_conversation(uuid) from public, anon, authenticated;
grant execute on function public.archive_prevent_recreation() to service_role;
grant execute on function public.archive_delete_conversation(uuid) to service_role;
commit;
