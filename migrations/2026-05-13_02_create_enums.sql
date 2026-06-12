-- Migration: 02 — Create v1 enum types
-- Phase:     1 (Org/User Schema, Enums, RLS)
-- Created:   2026-05-13
--
-- Purpose:
--   Define the locked enum vocabulary for v1. Lands BL-002 (type, severity)
--   in code and adds the deterministic priority enum (BL-001), plus the
--   ticket lifecycle/source/event enums needed for the data model.
--
--   - `ticket_type`        : what the ticket is about. LLM-produced; locked in BL-002.
--   - `ticket_severity`    : how bad it is. LLM-produced; locked in BL-002.
--   - `ticket_priority`    : derived by deterministic matrix from severity x type
--                            in Phase 2 (`services/features/triage/priorityMatrix.ts`).
--                            P1=Critical, P2=High, P3=Medium, P4=Low.
--   - `ticket_status`      : lifecycle state of a ticket row from intake to closure.
--   - `ticket_source_kind` : how the ticket entered the system. `in_app` is the v1
--                            caller; `aip_monitoring` is the Phase 10 placeholder.
--   - `ticket_event_type`  : event taxonomy on `ticket_events`. One row per
--                            material state transition during the triage pipeline.
--
-- Idempotency:
--   Postgres does not support `CREATE TYPE ... IF NOT EXISTS`. To make this
--   migration safely re-runnable we wrap each `CREATE TYPE` in a DO block that
--   checks `pg_type` first.
--
-- Rollback:
--   `DROP TYPE` for each enum. Will fail if any column still references it —
--   drop or alter dependent tables first.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'ticket_type') then
    create type ticket_type as enum (
      'bug',
      'feature',
      'improvement',
      'question',
      'incident'
    );
  end if;
end$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'ticket_severity') then
    create type ticket_severity as enum (
      'blocker',
      'major',
      'minor',
      'trivial'
    );
  end if;
end$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'ticket_priority') then
    create type ticket_priority as enum (
      'P1',
      'P2',
      'P3',
      'P4'
    );
  end if;
end$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'ticket_status') then
    create type ticket_status as enum (
      'received',
      'triaged',
      'duplicate',
      'pushed_to_linear',
      'failed',
      'closed'
    );
  end if;
end$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'ticket_source_kind') then
    create type ticket_source_kind as enum (
      'in_app',
      'aip_monitoring'
    );
  end if;
end$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'ticket_event_type') then
    create type ticket_event_type as enum (
      'received',
      'triaged',
      'deduplicated',
      'pushed_to_linear',
      'status_changed',
      'email_sent',
      'failed'
    );
  end if;
end$$;
