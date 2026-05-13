-- Migration: 08 — Enable RLS and add org-scoped policies
-- Phase:     1 (Org/User Schema, Enums, RLS)
-- Created:   2026-05-13
--
-- Purpose:
--   Enable Row Level Security on every org-scoped table and add the per-table
--   policies that key on `(auth.jwt() ->> 'org_id')::uuid`.
--
-- RLS posture in v1 (recap from the architecture doc):
--   v1 API runs server-to-server through the Supabase service-role client,
--   which BYPASSES RLS. So in practice these policies are defense-in-depth
--   for two cases:
--     1. Future user-JWT paths (admin tooling, customer portal).
--     2. Any non-service-role read that slips through during dev.
--   The service-role path is required to apply explicit `org_id` predicates
--   in every Provider query (see architecture doc, §Data Layer).
--
-- Policy template:
--   For tables whose own column is named `org_id`:
--     (auth.jwt() ->> 'org_id')::uuid = org_id
--   For `orgs` (whose own PK is `id`):
--     (auth.jwt() ->> 'org_id')::uuid = id
--   `auth.jwt()` returns null for unauthenticated callers, so the predicate
--   evaluates to null (= false) and the row is excluded — correct behavior.
--
--   Per-table, we add four permissive policies: SELECT, INSERT, UPDATE,
--   DELETE. Each policy is restricted to the matching predicate. INSERT
--   uses `with check`; UPDATE uses both `using` (which rows are visible to
--   update) and `with check` (what the post-update row must satisfy).
--
-- Idempotency:
--   `enable row level security` and `force row level security` are safely
--   re-runnable. Policies are dropped first (`drop policy if exists`) and
--   then created, so the file is fully re-runnable.
--
-- Rollback:
--   Disable RLS per table (`alter table ... disable row level security`) and
--   drop each policy. Both done in the rollback section of any future
--   "disable RLS" migration if needed.
--
-- Privileges:
--   RLS policies do not grant access by themselves. Supabase API access under
--   a user JWT runs as the `authenticated` role, so this file grants that role
--   the minimum table/type privileges needed for future user-context paths.
--   Service-role paths bypass RLS and remain constrained in Provider methods.

-- ============================================================================
-- orgs
-- ============================================================================
alter table orgs enable row level security;
alter table orgs force  row level security;

drop policy if exists orgs_select on orgs;
create policy orgs_select on orgs
  for select
  using ((auth.jwt() ->> 'org_id')::uuid = id);

drop policy if exists orgs_insert on orgs;
create policy orgs_insert on orgs
  for insert
  with check ((auth.jwt() ->> 'org_id')::uuid = id);

drop policy if exists orgs_update on orgs;
create policy orgs_update on orgs
  for update
  using      ((auth.jwt() ->> 'org_id')::uuid = id)
  with check ((auth.jwt() ->> 'org_id')::uuid = id);

drop policy if exists orgs_delete on orgs;
create policy orgs_delete on orgs
  for delete
  using ((auth.jwt() ->> 'org_id')::uuid = id);

-- ============================================================================
-- users
-- ============================================================================
alter table users enable row level security;
alter table users force  row level security;

drop policy if exists users_select on users;
create policy users_select on users
  for select
  using ((auth.jwt() ->> 'org_id')::uuid = org_id);

drop policy if exists users_insert on users;
create policy users_insert on users
  for insert
  with check ((auth.jwt() ->> 'org_id')::uuid = org_id);

drop policy if exists users_update on users;
create policy users_update on users
  for update
  using      ((auth.jwt() ->> 'org_id')::uuid = org_id)
  with check ((auth.jwt() ->> 'org_id')::uuid = org_id);

drop policy if exists users_delete on users;
create policy users_delete on users
  for delete
  using ((auth.jwt() ->> 'org_id')::uuid = org_id);

-- ============================================================================
-- tickets
-- ============================================================================
alter table tickets enable row level security;
alter table tickets force  row level security;

drop policy if exists tickets_select on tickets;
create policy tickets_select on tickets
  for select
  using ((auth.jwt() ->> 'org_id')::uuid = org_id);

drop policy if exists tickets_insert on tickets;
create policy tickets_insert on tickets
  for insert
  with check ((auth.jwt() ->> 'org_id')::uuid = org_id);

drop policy if exists tickets_update on tickets;
create policy tickets_update on tickets
  for update
  using      ((auth.jwt() ->> 'org_id')::uuid = org_id)
  with check ((auth.jwt() ->> 'org_id')::uuid = org_id);

drop policy if exists tickets_delete on tickets;
create policy tickets_delete on tickets
  for delete
  using ((auth.jwt() ->> 'org_id')::uuid = org_id);

-- ============================================================================
-- ticket_events
-- ============================================================================
alter table ticket_events enable row level security;
alter table ticket_events force  row level security;

drop policy if exists ticket_events_select on ticket_events;
create policy ticket_events_select on ticket_events
  for select
  using ((auth.jwt() ->> 'org_id')::uuid = org_id);

drop policy if exists ticket_events_insert on ticket_events;
create policy ticket_events_insert on ticket_events
  for insert
  with check ((auth.jwt() ->> 'org_id')::uuid = org_id);

-- ticket_events is append-only by design; UPDATE and DELETE are intentionally
-- excluded. If a future workflow needs to delete events (e.g., GDPR erasure),
-- it should land as a deliberate policy addition in a later migration.

-- ============================================================================
-- dedup_signatures
-- ============================================================================
alter table dedup_signatures enable row level security;
alter table dedup_signatures force  row level security;

drop policy if exists dedup_signatures_select on dedup_signatures;
create policy dedup_signatures_select on dedup_signatures
  for select
  using ((auth.jwt() ->> 'org_id')::uuid = org_id);

drop policy if exists dedup_signatures_insert on dedup_signatures;
create policy dedup_signatures_insert on dedup_signatures
  for insert
  with check ((auth.jwt() ->> 'org_id')::uuid = org_id);

drop policy if exists dedup_signatures_update on dedup_signatures;
create policy dedup_signatures_update on dedup_signatures
  for update
  using      ((auth.jwt() ->> 'org_id')::uuid = org_id)
  with check ((auth.jwt() ->> 'org_id')::uuid = org_id);

drop policy if exists dedup_signatures_delete on dedup_signatures;
create policy dedup_signatures_delete on dedup_signatures
  for delete
  using ((auth.jwt() ->> 'org_id')::uuid = org_id);

-- ============================================================================
-- authenticated role privileges for future user-JWT paths
-- ============================================================================
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant usage on schema public to authenticated;

    grant usage on type
      ticket_type,
      ticket_severity,
      ticket_priority,
      ticket_status,
      ticket_source_kind,
      ticket_event_type
    to authenticated;

    -- User-context paths should soft-delete via UPDATE. Hard deletes remain
    -- service-role/admin-only until a later workflow explicitly needs them.
    grant select, insert, update
      on orgs, users, tickets, dedup_signatures
      to authenticated;

    -- Append-only by design: no UPDATE/DELETE grants for events.
    grant select, insert
      on ticket_events
      to authenticated;
  end if;
end$$;
