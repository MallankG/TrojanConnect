-- TrojanConnect: venue booking and event permit requests (backend/app/workflows/booking).
--
-- Each request is stored as one JSON document (`doc`: payload, proposals, agent messages, review task,
-- approval, confirmation and audit timeline) with the columns the backend filters on pulled out.
-- PRD §13's normalised tables (booking_proposals, agent_messages, review_tasks, approval_events) can be
-- split out of `doc` later without changing the API.
--
-- Only the backend writes here, with the service-role key. RLS is on with no policies, so the anon and
-- authenticated roles can't read or write these tables directly.

create table if not exists booking_requests (
  id              uuid primary key,
  kind            text not null check (kind in ('venue_booking', 'event_permit')),
  event_id        text not null,
  state           text not null,
  version         integer not null default 1,
  authority_id    text,
  review_task_id  uuid unique,
  doc             jsonb not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists booking_requests_event_idx on booking_requests (event_id, kind, created_at desc);
create index if not exists booking_requests_queue_idx on booking_requests (authority_id, state);

-- Idempotency keys for booking writes (PRD §9.1): a retried click returns the same request.
create table if not exists booking_idempotency (
  key         text primary key,
  op          text not null,
  request_id  uuid not null references booking_requests (id) on delete cascade,
  created_at  timestamptz not null default now()
);

alter table booking_requests enable row level security;
alter table booking_idempotency enable row level security;
