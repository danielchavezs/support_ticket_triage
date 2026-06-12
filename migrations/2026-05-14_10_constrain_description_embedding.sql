-- Migration: 10 — Constrain `tickets.description_embedding` + add HNSW index
-- Phase:     3 (Deduplication)
-- Created:   2026-05-14
--
-- Purpose:
--   Phase 1 created `tickets.description_embedding` as unconstrained `vector`
--   with no dimensionality and no index, deferring the choice to Phase 3 once
--   BL-007 (embedding model) was locked. Phase 3 picks OpenAI
--   `text-embedding-3-large` truncated to 1536 dimensions via the Matryoshka
--   `dimensions` API parameter — small enough to fit standard pgvector HNSW
--   ceilings, large enough to preserve the bulk of model quality.
--
--   This migration:
--     1. Tightens the column type to `vector(1536)`. Any non-NULL row whose
--        dimension differs would cause the ALTER to fail — which is the
--        correct guard. In Phase 1/2 no rows have been embedded yet, so the
--        change is effectively NULL→NULL for every existing row.
--     2. Creates an HNSW partial index using `vector_cosine_ops`. Partial so
--        soft-deleted rows and rows without embeddings (e.g., deterministic
--        duplicates) don't bloat the index. Default `m`/`ef_construction`
--        parameters are appropriate for v1 ticket volume.
--
-- Fallback path (documented for completeness):
--   If 1536-dim Matryoshka-truncated embeddings degrade recall below useful
--   levels (see Phase 3 Risk #1 in `docs/DC/P3-deduplication-plan.md` §7), the
--   reversible follow-up is:
--     ALTER TABLE tickets
--       ALTER COLUMN description_embedding TYPE halfvec(3072)
--       USING description_embedding::halfvec(3072);
--     REINDEX INDEX tickets_description_embedding_hnsw_idx;
--   `halfvec` supports HNSW indexing up to 4000 dimensions, so the full 3072
--   stays indexable at the cost of slightly looser numerical precision.
--
-- Idempotency:
--   The ALTER is idempotent in practice — re-applying when the column is
--   already `vector(1536)` is a no-op. The index uses `IF NOT EXISTS`.
--
-- Rollback:
--   `DROP INDEX IF EXISTS tickets_description_embedding_hnsw_idx;
--    ALTER TABLE tickets ALTER COLUMN description_embedding TYPE vector;`

-- Tighten the column to a fixed dimension. All existing rows are NULL
-- (no embedding writes happened in Phase 1 or Phase 2), so the cast is
-- trivial. Any future non-NULL row that does not match 1536 would fail this
-- migration, which is the intended invariant.
alter table tickets
  alter column description_embedding type vector(1536);

-- HNSW index for fast cosine-similarity ANN lookups. Partial so:
--   - rows with no embedding (e.g., deterministic-dedup short-circuits) are
--     excluded;
--   - soft-deleted rows are excluded (they would never be valid dedup
--     candidates).
create index if not exists tickets_description_embedding_hnsw_idx
  on tickets using hnsw (description_embedding vector_cosine_ops)
  where description_embedding is not null and deleted_at is null;

comment on column tickets.description_embedding is 'pgvector(1536) embedding of the ticket description for vector-similarity dedup (Phase 3, BL-007). Source model: OpenAI text-embedding-3-large truncated via the `dimensions` API parameter.';
comment on index  tickets_description_embedding_hnsw_idx is 'HNSW (cosine) ANN index for Phase 3 vector dedup. Partial on (embedding NOT NULL AND deleted_at IS NULL) so dropped/no-embedding rows do not bloat the index.';
