-- Migration: 13 — Add `tickets.linear_state` column
-- Phase:     5 (Linear Inbound Webhook)
-- Created:   2026-05-18
--
-- Purpose:
--   Phase 5 receives Linear status-change webhooks and records the current
--   Linear workflow state on the ticket row. Linear's workflow states are
--   per-team and free-form (e.g., "In Progress", "Code Review", "Done"),
--   so we store them as plain text rather than constraining to our internal
--   `ticket_status` enum. The internal `status` enum is preserved for our
--   own lifecycle (received → triaged → … → closed); `linear_state` is the
--   external view.
--
--   Terminal-state transitions (Linear state.type = 'completed' or
--   'canceled') also flip our `status='closed'` — that logic lives in the
--   handleWebhook Feature, not in a DB trigger.
--
-- Idempotency:
--   `add column if not exists` makes this re-applicable.
--
-- Rollback:
--   `alter table tickets drop column if exists linear_state;`

alter table tickets
  add column if not exists linear_state text;

comment on column tickets.linear_state is
  'Latest Linear workflow state name as reported by the inbound webhook (Phase 5). Free-form text; not constrained to the internal ticket_status enum.';
