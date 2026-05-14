-- Migration: 01 — Enable required Postgres extensions
-- Phase:     1 (Org/User Schema, Enums, RLS)
-- Created:   2026-05-13
--
-- Purpose:
--   Enable the extensions every other Phase 1 migration depends on.
--   `vector` powers the dedup embeddings on `tickets.description_embedding`
--   (dimensionality and indexing are deferred until BL-007 lands in Phase 3).
--   `pgcrypto` provides `gen_random_uuid()` for default UUID primary keys
--   without relying on `uuid-ossp`, which Supabase deprecates in favor of
--   pgcrypto.
--
-- Idempotency:
--   Both statements use `IF NOT EXISTS`. Safe to re-run on any environment.
--
-- Rollback:
--   `DROP EXTENSION vector;` and `DROP EXTENSION pgcrypto;`
--   Only run rollback if you also intend to drop every dependent table —
--   Postgres will refuse to drop an extension that still has dependent
--   objects (vector columns, indexes, etc.).

create extension if not exists vector;
create extension if not exists pgcrypto;
