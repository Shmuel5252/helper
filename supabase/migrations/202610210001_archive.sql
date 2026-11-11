-- Private conversation archive. No anon/authenticated grants or RLS policies.
begin;
create table if not exists public.archive_conversations (
  id uuid primary key,
  owner text not null check (owner ~ '^[a-f0-9]{64}$'),
  title text not null check (length(title) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.archive_assets (
  id uuid primary key,
  conversation_id uuid not null references public.archive_conversations(id),
  name text not null,
  mime text not null,
  size bigint not null check (size > 0 and size <= 52428800),
  extracted_text text,
  created_at timestamptz not null default now()
);
create table if not exists public.archive_turns (
  id uuid primary key,
  conversation_id uuid not null references public.archive_conversations(id),
  sequence bigint generated always as identity unique,
  input_hash text not null,
  model_key text not null,
  input text not null,
  assets uuid[] not null default '{}',
  status text not null default 'starting' check (status in ('starting','running','completed','failed','uncertain')),
  provider_id text,
  output jsonb not null default '[]',
  error text,
  created_at timestamptz not null default now(),
  checked_at timestamptz not null default now()
);
create index if not exists archive_turns_conversation on public.archive_turns(conversation_id, sequence);
create index if not exists archive_turns_pending on public.archive_turns(checked_at) where status in ('starting','running');
create unique index if not exists archive_one_active_turn on public.archive_turns(conversation_id) where status in ('starting','running');
alter table public.archive_conversations enable row level security;
alter table public.archive_assets enable row level security;
alter table public.archive_turns enable row level security;
revoke all on public.archive_conversations, public.archive_assets, public.archive_turns from anon, authenticated;
grant select, insert, update, delete on public.archive_conversations, public.archive_assets, public.archive_turns to service_role;
grant usage, select on sequence public.archive_turns_sequence_seq to service_role;

create or replace function public.archive_begin_turn(p_owner text, p_conversation uuid, p_id uuid, p_hash text, p_model text, p_input text, p_assets uuid[])
returns boolean language plpgsql security invoker set search_path = '' as $$
declare existing public.archive_turns;
begin
  perform 1 from public.archive_conversations where id=p_conversation and owner=p_owner for update;
  if not found then raise exception 'conversation not found'; end if;
  select * into existing from public.archive_turns where id=p_id;
  if found then
    if existing.conversation_id <> p_conversation or existing.input_hash <> p_hash then raise exception 'request conflict'; end if;
    return false;
  end if;
  if exists (select 1 from unnest(p_assets) a where not exists (select 1 from public.archive_assets s where s.id=a and s.conversation_id=p_conversation)) then
    raise exception 'attachment not found';
  end if;
  insert into public.archive_turns(id,conversation_id,input_hash,model_key,input,assets) values(p_id,p_conversation,p_hash,p_model,p_input,p_assets);
  update public.archive_conversations set updated_at=now() where id=p_conversation;
  return true;
end $$;
revoke all on function public.archive_begin_turn(text,uuid,uuid,text,text,text,uuid[]) from public, anon, authenticated;
grant execute on function public.archive_begin_turn(text,uuid,uuid,text,text,text,uuid[]) to service_role;
insert into storage.buckets(id,name,public,file_size_limit) values('chat-archive','chat-archive',false,52428800) on conflict(id) do nothing;
commit;
