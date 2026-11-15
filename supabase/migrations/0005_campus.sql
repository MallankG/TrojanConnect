-- TrojanConnect: student-government and club-outreach records.
--
-- campus_records holds feedback, government questions (topic only, no identity), announcements,
-- representative-managed government sources and club posts. One row per record; `doc` is the record.
-- Only the backend writes here (service role); RLS is on with no policies.

create table if not exists campus_records (
  id          text primary key,
  kind        text not null check (kind in ('feedback', 'gov_question', 'announcement', 'gov_source', 'club_post')),
  scope       text not null,              -- 'USG' / 'GSG' or an organization id
  doc         jsonb not null,
  created_at  timestamptz not null default now()
);
create index if not exists campus_records_kind_scope_idx on campus_records (kind, scope, created_at desc);
alter table campus_records enable row level security;
