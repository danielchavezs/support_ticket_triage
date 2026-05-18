-- Migration: dev seed extension — Insert default `org_settings` row (DEV ONLY)
-- Phase:     3 (Deduplication)
-- Created:   2026-05-14
--
-- Purpose:
--   Insert a single `org_settings` row for the seed ATD-internal org so the
--   local dev path exercises both dedup strategies:
--     - `vector_dedup_enabled = true` so the vector branch runs during local
--       development.
--     - `dedup_window_days = NULL` so the system default (90 days) applies.
--
--   The seed ATD-internal org row is created by
--   `migrations/dev/2026-05-13_seed_dev_default.sql`; this file is a separate
--   migration so the original seed stays immutable.
--
-- WARNING:
--   DEV-ONLY. Never apply to deployed-dev or deployed-prod Supabase projects.
--   Production org/settings provisioning is a post-v1 concern.
--
-- Idempotency:
--   `ON CONFLICT (org_id) DO NOTHING` so re-runs are no-ops once the row
--   exists. The `org_settings.org_id` unique constraint backs this.
--
-- Rollback:
--   `DELETE FROM org_settings WHERE org_id = '00000000-0000-0000-0000-0000000000a0';`

insert into org_settings (org_id, dedup_window_days, vector_dedup_enabled)
values ('00000000-0000-0000-0000-0000000000a0', null, true)
on conflict (org_id) do nothing;
