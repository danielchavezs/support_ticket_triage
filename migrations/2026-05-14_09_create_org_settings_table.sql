-- Migration: 09 — Create `org_settings` table
-- Phase:     3 (Deduplication)
-- Created:   2026-05-14
--
-- Purpose:
--   Per-org configuration for dedup behavior. Phase 3 introduces two settings:
--     - `dedup_window_days`     : how far back to look for prior signatures.
--                                 NULL falls back to the system default (90).
--     - `vector_dedup_enabled`  : whether the vector-similarity strategy runs
--                                 on this org. Defaults to false; deterministic
--                                 hash still runs for every org regardless.
--
--   Locked via BL-005 and BL-006 in the Phase 3 plan. The table is 1:1 with
--   `orgs` (unique constraint on `org_id`), so reads are cheap and there is no
--   join cardinality risk in the dedup hot path.
--
--   No upsert path lands in this phase — settings are managed via the dev seed
--   (and, later, an admin tooling path). Keeping the surface minimal avoids
--   accidental writes from the Feature layer.
--
-- Org scoping:
--   `org_id` is UNIQUE NOT NULL with `ON DELETE CASCADE`. RLS lands in the
--   sibling `2026-05-14_11_enable_rls_org_settings.sql` migration.
--
-- Columns:
--   id                   : UUID PK.
--   org_id               : FK to orgs(id). Unique — one settings row per org.
--   dedup_window_days    : NULL → system default (90). Otherwise must be > 0.
--   vector_dedup_enabled : default false. Vector strategy gated on this flag.
--   created_at           : insert timestamp.
--   updated_at           : last-modified timestamp; maintained by trigger below.
--   deleted_at           : soft-delete sentinel; Provider wrappers filter
--                          `is null` by default.
--
-- Idempotency:
--   `IF NOT EXISTS` everywhere. The trigger is dropped before recreation so
--   the migration is safely re-runnable.
--
-- Rollback:
--   `DROP TRIGGER org_settings_set_updated_at ON org_settings;
--    DROP TABLE org_settings;`

create table if not exists org_settings (
  id                   uuid        primary key default gen_random_uuid(),
  org_id               uuid        not null references orgs(id) on delete cascade,
  dedup_window_days    int,
  vector_dedup_enabled boolean     not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz,

  constraint org_settings_org_id_uq unique (org_id),

  constraint org_settings_dedup_window_days_positive_chk
    check (dedup_window_days is null or dedup_window_days > 0)
);

-- Maintain updated_at via the shared trigger function defined in migration 03.
drop trigger if exists org_settings_set_updated_at on org_settings;
create trigger org_settings_set_updated_at
before update on org_settings
for each row execute function set_updated_at();

comment on table  org_settings                       is 'Per-org configuration for dedup behavior. 1:1 with orgs. Managed via seed/admin path, not Feature writes.';
comment on column org_settings.org_id                is 'FK to orgs(id). UNIQUE — one settings row per org.';
comment on column org_settings.dedup_window_days     is 'Window for deterministic + vector lookups in days. NULL means "use system default 90" (BL-005).';
comment on column org_settings.vector_dedup_enabled  is 'Gate on the vector-similarity dedup strategy. Default false; deterministic hash always runs (BL-006).';
comment on column org_settings.deleted_at            is 'Soft-delete sentinel. Provider wrappers filter `is null` by default.';
comment on constraint org_settings_org_id_uq on org_settings is 'Enforces a single settings row per org; satisfies the FK-supporting index implicitly.';
comment on constraint org_settings_dedup_window_days_positive_chk on org_settings is 'Window must be strictly positive when set; NULL is the "use system default" sentinel.';
