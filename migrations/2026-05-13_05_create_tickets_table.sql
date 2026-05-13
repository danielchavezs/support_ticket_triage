-- Migration: 05 — Create `tickets` table
-- Phase:     1 (Org/User Schema, Enums, RLS)
-- Created:   2026-05-13
--
-- Purpose:
--   The canonical ticket row. One row per submitted ticket, carrying the
--   intake context (org/user/source), the raw submission, the LLM-produced
--   classification (filled in Phase 2), the deterministic priority (also
--   Phase 2), dedup linkage (Phase 3), Linear linkage (Phase 4), and the
--   pgvector embedding (Phase 3) once an embedding model is locked.
--
--   Phase 1 inserts only persist the intake fields (`org_id`, `user_id`,
--   `source_kind`, `subject`, `description`) and leave everything triage-
--   related null. `status` defaults to `received`.
--
-- Identity / scoping:
--   - PK is `(id)`; UNIQUE on `(id, org_id)` enables composite foreign keys
--     from `ticket_events` and `dedup_signatures` to enforce org consistency.
--     Without that composite FK, a child row could point at a ticket from
--     a different org and slip past RLS via the join.
--   - `user_id` is validated with a composite FK on `(user_id, org_id)`, so
--     a ticket cannot claim one org while referencing a user from another.
--   - `duplicate_of` is validated with a composite self-FK on
--     `(duplicate_of, org_id)`, so duplicate linkage also stays org-local.
--
-- Vector embedding:
--   `description_embedding` is unconstrained `vector` (no dimension, no
--   index) in Phase 1. Per the plan's locked decision #8, dimensionality
--   and the IVFFlat/HNSW index choice land in Phase 3 once BL-007 picks the
--   embedding model.
--
-- Idempotency:
--   `IF NOT EXISTS` everywhere.
--
-- Rollback:
--   `DROP TRIGGER tickets_set_updated_at ON tickets; DROP TABLE tickets;`
--   (Will fail if `ticket_events` or `dedup_signatures` already reference it.)

create table if not exists tickets (
  id                       uuid                primary key default gen_random_uuid(),
  org_id                   uuid                not null references orgs(id)  on delete restrict,
  user_id                  uuid                not null,
  source_kind              ticket_source_kind  not null,

  -- Raw intake fields (always present).
  subject                  text                not null,
  description              text                not null,

  -- LLM classification + deterministic priority. Populated in Phase 2.
  type                     ticket_type,
  severity                 ticket_severity,
  priority                 ticket_priority,
  confidence               numeric,            -- 0.0..1.0, LLM-reported.
  customer_facing_summary  text,
  suggested_reply          text,

  -- Lifecycle.
  status                   ticket_status       not null default 'received',
  triage_error             text,               -- Free-form error tag when status='failed'.

  -- Dedup linkage. Both populated in Phase 3.
  dedup_signature          text,
  duplicate_of             uuid,

  -- Linear linkage. Populated in Phase 4 (outbound push).
  linear_issue_id          text,

  -- Embedding for vector-similarity dedup. Phase 3 fills + indexes.
  description_embedding    vector,

  -- Timestamps.
  created_at               timestamptz         not null default now(),
  updated_at               timestamptz         not null default now(),
  deleted_at               timestamptz,

  -- Composite unique key so children can FK against (id, org_id) to enforce
  -- cross-table org consistency.
  constraint tickets_id_org_uq unique (id, org_id),

  constraint tickets_user_org_fk
    foreign key (user_id, org_id)
    references users (id, org_id)
    on delete restrict,

  constraint tickets_duplicate_org_fk
    foreign key (duplicate_of, org_id)
    references tickets (id, org_id)
    on delete restrict,

  constraint tickets_duplicate_not_self_chk
    check (duplicate_of is null or duplicate_of <> id),

  constraint tickets_confidence_range_chk
    check (confidence is null or (confidence >= 0 and confidence <= 1))
);

-- Indexes that the v1 read paths will need.
-- Hot dashboard reads filter out soft-deleted rows, so the org/created and
-- org/status indexes are partial on `deleted_at is null` for tighter scans.
-- The linear_issue_id unique index is partial on non-null since the column is
-- populated only after Phase 4's push.
create index if not exists tickets_org_created_idx
  on tickets (org_id, created_at desc) where deleted_at is null;

create index if not exists tickets_org_status_idx
  on tickets (org_id, status) where deleted_at is null;

create unique index if not exists tickets_linear_issue_id_uq
  on tickets (linear_issue_id) where linear_issue_id is not null;

-- FK-supporting indexes. Postgres does not auto-index FK columns, so we add
-- these explicitly to keep join/cascade plans cheap.
create index if not exists tickets_user_id_idx       on tickets (user_id)      where deleted_at is null;
create index if not exists tickets_duplicate_of_idx  on tickets (duplicate_of) where duplicate_of is not null;

-- Maintain updated_at via the shared trigger function defined in 03.
drop trigger if exists tickets_set_updated_at on tickets;
create trigger tickets_set_updated_at
before update on tickets
for each row execute function set_updated_at();

comment on table  tickets                        is 'One row per submitted ticket. Intake fields filled in Phase 1; triage/dedup/Linear fields filled in later phases.';
comment on column tickets.org_id                 is 'FK to orgs(id). Required on every insert; service-role queries must include org_id predicate.';
comment on column tickets.user_id                is 'FK to users(id). The user the calling app asserted as the submitter.';
comment on column tickets.source_kind            is 'Intake source. v1 uses in_app; aip_monitoring is the Phase 10 placeholder.';
comment on column tickets.type                   is 'LLM-produced ticket type (Phase 2).';
comment on column tickets.severity               is 'LLM-produced severity (Phase 2).';
comment on column tickets.priority               is 'Derived deterministically from severity x type in Phase 2.';
comment on column tickets.description_embedding  is 'pgvector column for similarity dedup. Dimensionality + index land in Phase 3.';
comment on constraint tickets_id_org_uq on tickets is 'Composite unique enabling child FKs on (id, org_id) to enforce org consistency.';
comment on constraint tickets_user_org_fk on tickets is 'Composite FK to users(id, org_id), ensuring ticket user_id belongs to ticket org_id.';
comment on constraint tickets_duplicate_org_fk on tickets is 'Composite self-FK preventing cross-org duplicate linkage.';
comment on constraint tickets_duplicate_not_self_chk on tickets is 'Prevents a ticket from marking itself as its canonical duplicate.';
comment on constraint tickets_confidence_range_chk on tickets is 'LLM confidence scores are nullable during intake and constrained to the normalized 0..1 range when present.';
