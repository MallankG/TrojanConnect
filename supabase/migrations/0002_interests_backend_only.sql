-- Interest records carry consent and audit snapshots, so only the backend service role may create them.
drop policy if exists "student_agent_interests_own_insert" on public.club_interests;
