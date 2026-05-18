-- Migration: 11 — Enable RLS and add org-scoped policies on `org_settings`
-- Phase:     3 (Deduplication)
-- Created:   2026-05-14
--
-- Purpose:
--   Mirror the Phase 1 RLS posture (see `2026-05-13_08_enable_rls_and_policies.sql`)
--   for the new `org_settings` table. Service-role queries continue to bypass
--   RLS, so the Provider layer is still responsible for applying explicit
--   `org_id` predicates; these policies are defense-in-depth for future
--   user-JWT paths.
--
-- Policy template (matches existing tables):
--   USING/WITH CHECK: (auth.jwt() ->> 'org_id')::uuid = org_id
--
-- Idempotency:
--   `enable row level security` / `force row level security` are safely
--   re-runnable. Each policy is dropped first, then created.
--
-- Rollback:
--   `DROP POLICY ...; ALTER TABLE org_settings DISABLE ROW LEVEL SECURITY;`

alter table org_settings enable row level security;
alter table org_settings force  row level security;

drop policy if exists org_settings_select on org_settings;
create policy org_settings_select on org_settings
  for select
  using ((auth.jwt() ->> 'org_id')::uuid = org_id);

drop policy if exists org_settings_insert on org_settings;
create policy org_settings_insert on org_settings
  for insert
  with check ((auth.jwt() ->> 'org_id')::uuid = org_id);

drop policy if exists org_settings_update on org_settings;
create policy org_settings_update on org_settings
  for update
  using      ((auth.jwt() ->> 'org_id')::uuid = org_id)
  with check ((auth.jwt() ->> 'org_id')::uuid = org_id);

drop policy if exists org_settings_delete on org_settings;
create policy org_settings_delete on org_settings
  for delete
  using ((auth.jwt() ->> 'org_id')::uuid = org_id);

-- Grant the future user-context role the same posture as other org-scoped
-- tables. Service-role bypasses RLS and does not need a grant.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select, insert, update
      on org_settings
      to authenticated;
  end if;
end$$;
