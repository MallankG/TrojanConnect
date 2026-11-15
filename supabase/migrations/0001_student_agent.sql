-- TrojanConnect: student-agent tables (club discovery, club chat, preferences, interests).
-- Student side only. Booking / venue / government tables belong to other migrations.
-- Column names mirror backend/app/schemas/student.py and are read/written by
-- backend/app/repositories/supabase_repo.py. Keep the three in sync.
--
-- Ids are TEXT (not uuid) so demo ids such as 'demo-student-1' and 'club-ai-society' work;
-- real Supabase users are stored as auth.uid()::text. All timestamps are UTC timestamptz.
-- The backend uses the service-role key, which bypasses RLS; the policies below protect
-- direct client access with the anon/authenticated keys.

create extension if not exists vector;

-- ---------- identities ----------
create table if not exists profiles (
    id             text primary key,            -- auth.uid()::text or a demo id
    display_name   text not null default '',
    email          text not null default '',
    phone_verified boolean not null default false,
    timezone       text not null default 'America/Los_Angeles',
    created_at     timestamptz not null default now()
);

create table if not exists organizations (
    id                  text primary key,
    name                text not null,
    type                text not null default 'club',
    description         text not null default '',
    verification_status text not null default 'verified'
        check (verification_status in ('verified', 'pending', 'unverified')),
    created_at          timestamptz not null default now()
);

-- ---------- public club data ----------
create table if not exists club_profiles (
    organization_id                text primary key references organizations(id) on delete cascade,
    name                           text not null,
    slug                           text not null unique,
    category                       text not null,
    tags                           jsonb not null default '[]'::jsonb,
    public_description             text not null,
    history                        text not null default '',
    founded_year                   integer,
    activities                     jsonb not null default '[]'::jsonb,
    notable_events                 jsonb not null default '[]'::jsonb,
    meeting_schedule               text not null default '',
    time_commitment                text not null default '',
    time_commitment_hours_per_week double precision,
    membership_requirements        text not null default '',
    recruitment_status             text not null default 'unknown'
        check (recruitment_status in ('open', 'application', 'closed', 'unknown')),
    how_to_join                    text not null default '',
    who_thrives_here               text not null default '',
    faq                            jsonb not null default '[]'::jsonb,   -- [{question, answer}]
    public_contact                 text not null default '',
    verification_status            text not null default 'verified'
        check (verification_status in ('verified', 'pending', 'unverified')),
    data_label                     text not null default 'demo'
        check (data_label in ('demo', 'public_web', 'live')),
    website                        text not null default '',
    social_links                   jsonb not null default '{}'::jsonb,   -- {instagram: url, ...}
    source_urls                    jsonb not null default '[]'::jsonb,
    collected_at                   text,                                  -- ISO date string (schema keeps it as str)
    embedding                      vector(768),                           -- nullable; backfilled by the backend
    created_at                     timestamptz not null default now(),
    updated_at                     timestamptz not null default now()
);
create index if not exists club_profiles_category_idx on club_profiles (category);
create index if not exists club_profiles_tags_idx on club_profiles using gin (tags);
create index if not exists club_profiles_embedding_idx on club_profiles using hnsw (embedding vector_cosine_ops);

create table if not exists events (
    id              text primary key,
    organization_id text not null references organizations(id) on delete cascade,
    title           text not null,
    description     text not null default '',
    start_at        timestamptz not null,
    end_at          timestamptz not null,
    location        text not null default '',
    visibility      text not null default 'public' check (visibility in ('public', 'members')),
    timezone        text not null default 'America/Los_Angeles',          -- event's IANA zone (PRD 13)
    created_at      timestamptz not null default now(),
    check (end_at >= start_at)
);
create index if not exists events_org_start_idx on events (organization_id, start_at);
create index if not exists events_start_idx on events (start_at);

-- ---------- student-private data ----------
create table if not exists student_preferences (
    user_id                  text primary key references profiles(id) on delete cascade,
    interest_tags            jsonb not null default '[]'::jsonb,
    goals                    text not null default '',
    year_level               text check (year_level in ('freshman', 'sophomore', 'junior', 'senior', 'graduate')),
    hours_per_week_available double precision check (hours_per_week_available between 0 and 60),
    personalization_enabled  boolean not null default true,
    updated_at               timestamptz not null default now()
);

create table if not exists saved_clubs (
    user_id         text not null references profiles(id) on delete cascade,
    organization_id text not null references organizations(id) on delete cascade,
    created_at      timestamptz not null default now(),
    primary key (user_id, organization_id)
);

create table if not exists recommendation_feedback (
    id              uuid primary key default gen_random_uuid(),
    user_id         text not null references profiles(id) on delete cascade,
    organization_id text not null references organizations(id) on delete cascade,
    feedback        text not null check (feedback in ('helpful', 'not_relevant', 'hide')),
    created_at      timestamptz not null default now(),
    unique (user_id, organization_id)                                     -- latest feedback wins
);

create table if not exists conversations (
    id              text primary key,
    owner_user_id   text not null references profiles(id) on delete cascade,
    agent_type      text not null check (agent_type in ('student', 'club')),
    agent_id        text not null,              -- student_agent:{user_id} | club_agent:{organization_id}
    organization_id text references organizations(id) on delete set null,
    channel         text not null default 'web' check (channel in ('web', 'whatsapp', 'telegram')),
    title           text not null default '',
    created_at      timestamptz not null default now()
);
create index if not exists conversations_owner_idx on conversations (owner_user_id, created_at desc);
create index if not exists conversations_org_idx on conversations (organization_id);

create table if not exists messages (
    id              text primary key,
    conversation_id text not null references conversations(id) on delete cascade,
    sender_type     text not null check (sender_type in ('user', 'agent', 'system')),
    content         text not null,
    metadata        jsonb not null default '{}'::jsonb,
    created_at      timestamptz not null default now()
);
create index if not exists messages_conversation_idx on messages (conversation_id, created_at);

create table if not exists club_interests (
    id               text primary key,
    student_id       text not null references profiles(id) on delete cascade,
    organization_id  text not null references organizations(id) on delete cascade,
    interest_type    text not null check (interest_type in ('membership', 'event', 'general')),
    message          text not null default '',
    share_contact    boolean not null default false,
    consent_snapshot jsonb not null default '{}'::jsonb,
    idempotency_key  text not null,
    created_at       timestamptz not null default now(),
    unique (student_id, organization_id, idempotency_key)
);
create index if not exists club_interests_org_idx on club_interests (organization_id, created_at);

create table if not exists audit_logs (
    id            text primary key,
    actor_id      text not null,                -- no FK: audit rows must outlive the actor
    action        text not null,
    resource_type text not null,
    resource_id   text not null,
    metadata      jsonb not null default '{}'::jsonb,
    created_at    timestamptz not null default now()
);
create index if not exists audit_logs_actor_idx on audit_logs (actor_id, created_at desc);
create index if not exists audit_logs_resource_idx on audit_logs (resource_type, resource_id);

-- ---------- semantic search ----------
-- Cosine similarity over club_profiles.embedding. Called by SupabaseRepository.match_clubs.
create or replace function match_clubs(query_embedding vector(768), match_count int)
returns table (organization_id text, similarity double precision)
language sql
stable
as $$
    select cp.organization_id,
           1 - (cp.embedding <=> query_embedding) as similarity
    from club_profiles cp
    where cp.embedding is not null
    order by cp.embedding <=> query_embedding
    limit greatest(match_count, 0);
$$;

-- ---------- row level security ----------
alter table profiles                enable row level security;
alter table organizations           enable row level security;
alter table club_profiles           enable row level security;
alter table events                  enable row level security;
alter table student_preferences     enable row level security;
alter table saved_clubs             enable row level security;
alter table recommendation_feedback enable row level security;
alter table conversations           enable row level security;
alter table messages                enable row level security;
alter table club_interests          enable row level security;
alter table audit_logs              enable row level security;
-- The service role bypasses RLS. audit_logs has no policies: backend-only.

-- Public read: club directory and public events.
drop policy if exists "student_agent_organizations_public_read" on organizations;
create policy "student_agent_organizations_public_read" on organizations
    for select to anon, authenticated using (true);

drop policy if exists "student_agent_club_profiles_public_read" on club_profiles;
create policy "student_agent_club_profiles_public_read" on club_profiles
    for select to anon, authenticated using (true);

drop policy if exists "student_agent_events_public_read" on events;
create policy "student_agent_events_public_read" on events
    for select to anon, authenticated using (visibility = 'public');

-- Own profile.
drop policy if exists "student_agent_profiles_own_select" on profiles;
create policy "student_agent_profiles_own_select" on profiles
    for select to authenticated using (id = (select auth.uid())::text);
drop policy if exists "student_agent_profiles_own_insert" on profiles;
create policy "student_agent_profiles_own_insert" on profiles
    for insert to authenticated with check (id = (select auth.uid())::text);
drop policy if exists "student_agent_profiles_own_update" on profiles;
create policy "student_agent_profiles_own_update" on profiles
    for update to authenticated
    using (id = (select auth.uid())::text) with check (id = (select auth.uid())::text);

-- Own preferences.
drop policy if exists "student_agent_preferences_own" on student_preferences;
create policy "student_agent_preferences_own" on student_preferences
    for all to authenticated
    using (user_id = (select auth.uid())::text) with check (user_id = (select auth.uid())::text);

-- Own saved clubs.
drop policy if exists "student_agent_saved_clubs_own" on saved_clubs;
create policy "student_agent_saved_clubs_own" on saved_clubs
    for all to authenticated
    using (user_id = (select auth.uid())::text) with check (user_id = (select auth.uid())::text);

-- Own recommendation feedback.
drop policy if exists "student_agent_feedback_own" on recommendation_feedback;
create policy "student_agent_feedback_own" on recommendation_feedback
    for all to authenticated
    using (user_id = (select auth.uid())::text) with check (user_id = (select auth.uid())::text);

-- Own conversations and their messages: READ ONLY for clients.
-- Every write goes through the backend (service role), which also decides what an agent
-- turn contains. A client that could insert or edit a message could forge an agent turn
-- carrying a pending_confirmation, and /conversations/{id}/confirm trusts that payload.
drop policy if exists "student_agent_conversations_own" on conversations;
drop policy if exists "student_agent_conversations_own_select" on conversations;
create policy "student_agent_conversations_own_select" on conversations
    for select to authenticated
    using (owner_user_id = (select auth.uid())::text);

drop policy if exists "student_agent_messages_own" on messages;
drop policy if exists "student_agent_messages_own_select" on messages;
create policy "student_agent_messages_own_select" on messages
    for select to authenticated
    using (exists (select 1 from conversations c
                   where c.id = messages.conversation_id and c.owner_user_id = (select auth.uid())::text));

-- Own interests: students may read and create, never edit or delete (consent record).
drop policy if exists "student_agent_interests_own_select" on club_interests;
create policy "student_agent_interests_own_select" on club_interests
    for select to authenticated using (student_id = (select auth.uid())::text);
drop policy if exists "student_agent_interests_own_insert" on club_interests;
create policy "student_agent_interests_own_insert" on club_interests
    for insert to authenticated with check (student_id = (select auth.uid())::text);
