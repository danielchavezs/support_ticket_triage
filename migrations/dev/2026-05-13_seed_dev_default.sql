-- Migration: 09 — Seed default ATD-internal org and dev user (DEV ONLY)
-- Phase:     1 (Org/User Schema, Enums, RLS)
-- Created:   2026-05-13
--
-- Purpose:
--   Insert a single `ATD-internal` org and a single dev user so the dashboard
--   and the existing client can continue functioning during development
--   without needing real provisioning. The dashboard reads these UUIDs from
--   `NEXT_PUBLIC_DEV_ORG_ID` and `NEXT_PUBLIC_DEV_USER_ID` env vars (added in
--   Stage P1.5).
--
-- WARNING:
--   This migration is DEV-ONLY. The stable UUIDs below are intentionally
--   well-known so the env vars in `.env.local.example` can reference them
--   directly. Never apply this file to a deployed-dev or deployed-prod
--   Supabase project — production org/user provisioning is a post-v1 concern
--   and will land through a separate mechanism (admin tooling, calling-app
--   handshake, etc.).
--
--   Stage P1.2 of the Phase 1 plan defines the application protocol: when
--   pushing migrations to a non-local environment, this file is excluded.
--   In Supabase CLI workflows this typically means moving it under
--   `supabase/seed.sql` or invoking it manually only against local dev.
--
-- Idempotency:
--   Uses `ON CONFLICT DO NOTHING` so re-running the migration is a no-op
--   if the rows already exist.
--
-- Rollback:
--   `DELETE FROM users WHERE id = '00000000-0000-0000-0000-0000000000a1';
--    DELETE FROM orgs  WHERE id = '00000000-0000-0000-0000-0000000000a0';`

-- Default org. UUID is well-known and referenced by NEXT_PUBLIC_DEV_ORG_ID.
insert into orgs (id, name, status)
values ('00000000-0000-0000-0000-0000000000a0', 'ATD-internal', 'active')
on conflict (id) do nothing;

-- Default dev user. UUID is well-known and referenced by NEXT_PUBLIC_DEV_USER_ID.
-- Email is intentionally a placeholder; replace via the app's user-management
-- flow when one exists.
insert into users (id, org_id, email, display_name)
values (
  '00000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000a0',
  'dev@airiam.local',
  'ATD Dev User'
)
on conflict (id) do nothing;
