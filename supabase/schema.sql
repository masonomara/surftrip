-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Reusable trigger function that stamps updated_at on any row update.
-- security invoker: runs as the calling user, not the definer.
-- set search_path = '': prevents search path injection attacks.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ============================================================
-- TABLES
-- ============================================================

-- conversations: one row per chat session.
create table public.conversations (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  title       text        not null default 'New conversation',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- messages: one row per turn (user or assistant).
create table public.messages (
  id              uuid        primary key default gen_random_uuid(),
  conversation_id uuid        not null references public.conversations(id) on delete cascade,
  role            text        not null,
  content         text        not null,
  created_at      timestamptz not null default now(),

  constraint messages_role_check check (role in ('user', 'assistant'))
);


-- ============================================================
-- INDEXES
-- ============================================================

-- Sidebar query: list conversations for a user, newest first.
create index conversations_user_id_updated_at_idx
  on public.conversations (user_id, updated_at desc);

-- Chat view query: load all messages for a conversation, in order.
create index messages_conversation_id_created_at_idx
  on public.messages (conversation_id, created_at asc);


-- ============================================================
-- TRIGGERS
-- ============================================================

-- Auto-stamp conversations.updated_at on every row update.
create trigger set_conversations_updated_at
  before update on public.conversations
  for each row
  execute function public.set_updated_at();


-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.conversations enable row level security;
alter table public.messages      enable row level security;

-- conversations: users own their own rows, full CRUD.
create policy "conversations_select"
  on public.conversations for select
  using (auth.uid() = user_id);

create policy "conversations_insert"
  on public.conversations for insert
  with check (auth.uid() = user_id);

create policy "conversations_update"
  on public.conversations for update
  using (auth.uid() = user_id);

create policy "conversations_delete"
  on public.conversations for delete
  using (auth.uid() = user_id);

-- messages: access is gated through conversation ownership.
-- A user can read/write/delete messages in conversations they own.
create policy "messages_select"
  on public.messages for select
  using (
    conversation_id in (
      select id from public.conversations where user_id = auth.uid()
    )
  );

create policy "messages_insert"
  on public.messages for insert
  with check (
    conversation_id in (
      select id from public.conversations where user_id = auth.uid()
    )
  );

create policy "messages_delete"
  on public.messages for delete
  using (
    conversation_id in (
      select id from public.conversations where user_id = auth.uid()
    )
  );
