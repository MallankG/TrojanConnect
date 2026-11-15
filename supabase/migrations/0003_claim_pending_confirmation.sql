-- A single stored choice wins when confirm/cancel requests race across workers.
create or replace function public.claim_pending_confirmation(
    p_conversation_id text,
    p_message_id text,
    p_confirmed boolean
)
returns table (pending_confirmation jsonb)
language sql
set search_path = public
as $$
    update public.messages
    set metadata = jsonb_set(metadata, '{confirmation_decision}', to_jsonb(p_confirmed), true)
    where id = p_message_id
      and conversation_id = p_conversation_id
      and sender_type = 'agent'
      and coalesce(metadata->'pending_confirmation', 'null'::jsonb) <> 'null'::jsonb
      and (not (metadata ? 'confirmation_decision')
           or metadata->'confirmation_decision' = to_jsonb(p_confirmed))
    returning metadata->'pending_confirmation';
$$;

revoke all on function public.claim_pending_confirmation(text, text, boolean) from public, anon, authenticated;
grant execute on function public.claim_pending_confirmation(text, text, boolean) to service_role;
