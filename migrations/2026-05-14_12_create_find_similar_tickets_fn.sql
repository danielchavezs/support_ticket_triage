-- Migration: 12 — Create `find_similar_tickets` RPC function
-- Phase:     3 (Deduplication)
-- Created:   2026-05-14
--
-- Purpose:
--   Vector-similarity lookup helper for Phase 3 dedup. Returns the top-K
--   tickets in an org whose `description_embedding` is within cosine
--   similarity threshold of a query vector, scoped to:
--     - the caller's `org_id` (MANDATORY predicate; cross-org leakage is a
--       critical bug);
--     - the dedup window (BL-005, per-org configurable via `org_settings`);
--     - non-soft-deleted rows;
--     - canonical rows only (rows that are themselves duplicates of something
--       else are skipped — we want the canonical chain root).
--
--   Implemented as a SQL function so the Supabase TS client can call it via
--   `.rpc('find_similar_tickets', { ... })`. The TS client's `.from(...).
--   order(...)` does not accept the pgvector distance operator, so an RPC
--   wrapper is the cleanest path.
--
-- Security:
--   `SECURITY INVOKER` so RLS still applies if ever called under a user JWT.
--   `STABLE` because the function reads tables but does not mutate.
--   `GRANT EXECUTE` to `authenticated` (forward-compatible) and `service_role`
--    (current v1 caller) is wrapped in a role-existence check, matching the
--    Phase 1 RLS migration pattern.
--
-- Idempotency:
--   `create or replace function` makes the definition fully re-runnable.
--
-- Rollback:
--   `DROP FUNCTION find_similar_tickets(uuid, vector, int, float, int);`

create or replace function find_similar_tickets(
  p_org_id               uuid,
  p_query_embedding      vector(1536),
  p_window_days          int,
  p_similarity_threshold float,
  p_limit                int
)
returns table (
  ticket_id  uuid,
  similarity float
)
language sql
stable
security invoker
as $$
  select
    t.id                                                                  as ticket_id,
    (1 - (t.description_embedding <=> p_query_embedding))::float          as similarity
  from tickets t
  where t.org_id = p_org_id                                                                                   -- mandatory org predicate
    and t.description_embedding is not null
    and t.deleted_at is null
    and t.duplicate_of is null
    and t.created_at >= now() - (p_window_days * interval '1 day')
    and (1 - (t.description_embedding <=> p_query_embedding)) >= p_similarity_threshold
  order by t.description_embedding <=> p_query_embedding                  -- ascending distance = descending similarity
  limit p_limit;
$$;

comment on function find_similar_tickets(uuid, vector, int, float, int) is
  'Phase 3 vector-similarity dedup lookup. Returns top-K tickets in an org by cosine similarity, gated by window + threshold. SECURITY INVOKER — RLS applies under a user JWT.';

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function find_similar_tickets(uuid, vector, int, float, int)
      to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function find_similar_tickets(uuid, vector, int, float, int)
      to service_role;
  end if;
end$$;
