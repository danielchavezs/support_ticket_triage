-- Migration: 06 — Create `ticket_events` table
-- Phase:     1 (Org/User Schema, Enums, RLS)
-- Created:   2026-05-13
--
-- Purpose:
--   Append-only event log per ticket. v1 captures every material state
--   transition during the triage pipeline (received, triaged, deduplicated,
--   pushed_to_linear, status_changed, email_sent, failed) so the audit trail
--   is reconstructable without depending on Linear or email provider history.
--
--   In Phase 1 only `received` events are emitted (on ticket insert). Phase 2
--   adds `triaged` / `failed`, Phase 3 adds `deduplicated`, Phase 4 adds
--   `pushed_to_linear`, Phase 5 adds `status_changed`, Phase 6 adds
--   `email_sent`.
--
-- Org scoping:
--   `org_id` is denormalized onto each event so RLS on `ticket_events` uses
--   the same `(auth.jwt() ->> 'org_id')::uuid = org_id` predicate as every
--   other org-scoped table — no join through `tickets` required at policy
--   evaluation time.
--
--   Consistency between `org_id` and the parent ticket's `org_id` is enforced
--   by the composite FK below, which references `tickets(id, org_id)`. A row
--   pointing at a ticket from a different org cannot be inserted.
--
-- Columns:
--   id         : UUID PK.
--   org_id     : FK to orgs(id). Denormalized; see above.
--   ticket_id  : FK to tickets(id) via the composite FK below.
--   event_type : ticket_event_type enum.
--   payload    : free-form jsonb. Different event_types carry different
--                payload shapes; v1 keeps them schemaless to avoid premature
--                lock-in.
--   created_at : insert timestamp. The table is append-only, so there is no
--                updated_at and no deleted_at — history is immutable.
--
-- Idempotency:
--   `IF NOT EXISTS` everywhere.
--
-- Rollback:
--   `DROP TABLE ticket_events;`

create table if not exists ticket_events (
  id          uuid                primary key default gen_random_uuid(),
  org_id      uuid                not null references orgs(id) on delete cascade,
  ticket_id   uuid                not null,
  event_type  ticket_event_type   not null,
  payload     jsonb               not null default '{}'::jsonb,
  created_at  timestamptz         not null default now(),

  -- Composite FK guarantees the event's org_id matches the parent ticket's
  -- org_id. Without this, an event could refer to a ticket from a different
  -- org and RLS would pass for the event row while pointing at off-tenant data.
  constraint ticket_events_ticket_org_fk
    foreign key (ticket_id, org_id)
    references tickets (id, org_id)
    on delete cascade
);

-- Common access patterns: list events for a ticket in order, and list recent
-- events for an org (e.g., dashboard activity feed).
create index if not exists ticket_events_ticket_created_idx on ticket_events (ticket_id, created_at);
create index if not exists ticket_events_org_created_idx    on ticket_events (org_id,    created_at desc);

comment on table  ticket_events                  is 'Append-only event log. Immutable; no updated_at, no deleted_at.';
comment on column ticket_events.org_id           is 'Denormalized from tickets for RLS uniformity; consistency enforced by composite FK.';
comment on column ticket_events.payload          is 'Free-form jsonb. Shape varies by event_type; v1 does not enforce per-type schemas.';
comment on constraint ticket_events_ticket_org_fk on ticket_events is 'Composite FK to tickets(id, org_id) preventing cross-org event linkage.';
