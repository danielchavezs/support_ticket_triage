-- Migration: 14 — Create `webhook_deliveries` table for inbound idempotency
-- Phase:     5 (Linear Inbound Webhook)
-- Created:   2026-05-18
--
-- Purpose:
--   The Linear webhook endpoint receives at-least-once deliveries. To process
--   each unique delivery exactly once, we record a SHA-256 hash of the raw
--   request body, keyed on (provider, delivery_hash) with a unique
--   constraint. A duplicate delivery violates the constraint; the Feature
--   catches the violation and returns 200 without re-running the side
--   effects. A delivery is only considered duplicate after it reaches
--   `processing_status='processed'`; failed/incomplete deliveries may be
--   retried by Linear.
--
--   The table is NOT org-scoped: signature failures and "unknown
--   linear_issue_id" cases happen before we can resolve an org. `ticket_id`
--   and `org_id` are nullable backfills that the Feature populates on the
--   happy path, so operators can query "what webhook drove this ticket
--   change" without a join through `ticket_events`.
--
-- RLS:
--   Not enabled. The table is service-role only and contains no
--   customer-identifying data beyond the hash. If a future user-JWT path
--   ever reads from here (unlikely), RLS can be enabled in a follow-up
--   migration alongside per-org policies.
--
-- Retention:
--   Unbounded in v1. The table is small (one row per inbound webhook). A
--   scheduled cleanup (`delete where received_at < now() - '30 days'`)
--   is a one-line follow-up if growth ever becomes a concern.
--
-- Idempotency:
--   `create table if not exists` and `create unique index if not exists`.
--
-- Rollback:
--   `drop table if exists webhook_deliveries;`

create table if not exists webhook_deliveries (
  id              uuid        primary key default gen_random_uuid(),
  -- Webhook source (e.g., 'linear'). Scoped wider than 'linear' so future
  -- providers (email bounce events, etc.) can share the table.
  provider        text        not null,
  -- SHA-256 hash of the raw request body. Hex-encoded, lowercase, 64 chars.
  delivery_hash   text        not null,
  -- When we recorded the delivery.
  received_at     timestamptz not null default now(),
  -- Optional backfills populated by the Feature on the happy path.
  ticket_id       uuid,
  org_id          uuid,
  event_type      text,
  processing_status text not null default 'processing'
    check (processing_status in ('processing', 'processed', 'failed')),
  processed_at    timestamptz,
  last_error      text,
  -- One delivery per (provider, hash) — duplicate deliveries violate this.
  constraint webhook_deliveries_provider_hash_uq unique (provider, delivery_hash)
);

-- Operator-facing index: "show me recent Linear deliveries."
create index if not exists webhook_deliveries_provider_received_idx
  on webhook_deliveries (provider, received_at desc);

comment on table webhook_deliveries is
  'Inbound webhook delivery log keyed on (provider, sha256(raw_body)). Used by Phase 5 to make Linear webhook handling idempotent.';
comment on column webhook_deliveries.delivery_hash is
  'Hex-encoded SHA-256 of the raw request body. Stable across Linear retries since they resend the same bytes.';
comment on column webhook_deliveries.ticket_id is
  'Backfilled by the Feature on the happy path so operators can correlate deliveries with ticket changes. Nullable: signature-failed or unknown-ticket deliveries leave this null.';
comment on column webhook_deliveries.processing_status is
  'processing until the Feature reaches a successful terminal outcome, processed after successful handling, failed when handling returns a retryable non-2xx.';
