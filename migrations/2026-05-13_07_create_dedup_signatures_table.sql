-- Migration: 07 — Create `dedup_signatures` table
-- Phase:     1 (Org/User Schema, Enums, RLS)
-- Created:   2026-05-13
--
-- Purpose:
--   Deterministic-hash index for dedup lookup. One row per
--   `(org_id, normalized_signature)` pair, with a reference back to the
--   canonical ticket that defined the signature. The table itself is
--   created in Phase 1; the writing/lookup behavior lands in Phase 3
--   once BL-004/005/006 are resolved.
--
-- Org scoping:
--   The unique constraint is on `(org_id, normalized_signature)` so the same
--   normalized text submitted by two different orgs does NOT collide. The
--   composite FK to `tickets(id, org_id)` enforces that `canonical_ticket_id`
--   belongs to the same org — preventing cross-org dedup linkage just like
--   `ticket_events` does for event linkage.
--
-- Columns:
--   id                   : UUID PK.
--   org_id               : FK to orgs(id).
--   normalized_signature : the hash output (or normalized-text fingerprint)
--                          chosen in Phase 3. Stored as text to leave the
--                          exact hashing strategy flexible.
--   canonical_ticket_id  : FK to tickets(id) via the composite FK below.
--                          The "original" ticket; future duplicates point at
--                          this one via `tickets.duplicate_of`.
--   created_at           : insert timestamp. Phase 3 may add a dedup window
--                          (BL-005) — if so, queries will compare
--                          `created_at >= now() - interval '...'`.
--
-- Idempotency:
--   `IF NOT EXISTS` everywhere.
--
-- Rollback:
--   `DROP TABLE dedup_signatures;`

create table if not exists dedup_signatures (
  id                   uuid        primary key default gen_random_uuid(),
  org_id               uuid        not null references orgs(id) on delete cascade,
  normalized_signature text        not null,
  canonical_ticket_id  uuid        not null,
  created_at           timestamptz not null default now(),

  -- Composite FK guarantees canonical_ticket_id belongs to the same org as
  -- this signature row.
  constraint dedup_signatures_ticket_org_fk
    foreign key (canonical_ticket_id, org_id)
    references tickets (id, org_id)
    on delete cascade,

  -- Per-org uniqueness on the normalized signature.
  constraint dedup_signatures_org_signature_uq
    unique (org_id, normalized_signature)
);

-- Optional read path for "all dedup signatures for an org ordered by recency"
-- (e.g., for the dedup-window query Phase 3 may need).
create index if not exists dedup_signatures_org_created_idx on dedup_signatures (org_id, created_at desc);

-- FK-supporting index for reverse lookups ("which signature points at this
-- canonical ticket"). Postgres does not auto-index FK columns.
create index if not exists dedup_signatures_canonical_ticket_idx
  on dedup_signatures (canonical_ticket_id);

comment on table  dedup_signatures                   is 'Deterministic-hash index for dedup lookup. Behavior lands in Phase 3.';
comment on column dedup_signatures.normalized_signature is 'Hash or normalized-text fingerprint. Exact strategy chosen in Phase 3.';
comment on column dedup_signatures.canonical_ticket_id  is 'The original ticket; duplicates point at this one via tickets.duplicate_of.';
comment on constraint dedup_signatures_ticket_org_fk on dedup_signatures is 'Composite FK to tickets(id, org_id) preventing cross-org dedup linkage.';
