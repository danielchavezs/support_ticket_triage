# DC P3 — Deduplication (Deterministic + Vector) Plan

| Field | Value |
| --- | --- |
| Owner | Daniel Chávez (ATD) |
| Phase | Phase 3 (Deduplication) |
| Parent Plan | [`docs/DC/airiam-ticket-triage-roadmap.md`](./airiam-ticket-triage-roadmap.md) |
| Decision Baseline | `BL-004`, `BL-005`, `BL-006`, `BL-007` (resolved 2026-05-14, this plan) |
| Architecture Baseline | [`docs/DC/airiam-ticket-triage-architecture.md`](./airiam-ticket-triage-architecture.md) |
| Status | Implementation complete (2026-05-14); manual smoke pending |
| Priority | P0 |

## 1. Context

Phase 2 (triage refactor) currently sits on `feature/dedup-linear-lifecycle` (commit `c14471b`) and has not been merged to `main` yet. Every ticket that flows through `createTicketFeature` is persisted, gets a `received` event, then is handed inline to `triageTicketFeature`. There is no dedup step; identical or near-identical tickets create independent rows and burn LLM tokens on triage.

Phase 3 inserts step 2 of the architecture pipeline — **deduplicate before classify** — and lights up the four dedup-related schema affordances already laid down in Phase 1: `tickets.dedup_signature`, `tickets.duplicate_of`, `tickets.description_embedding`, `dedup_signatures` table, `ticket_status='duplicate'`, and `ticket_event_type='deduplicated'`. The pipeline becomes:

```
create row (status='received')
  → emit 'received'
  → dedup check  ← NEW
       ├─ deterministic hash hit → set duplicate_of + status='duplicate' + emit 'deduplicated' → skip triage
       ├─ vector hit only        → emit 'deduplicated' (audit only) → continue to triage
       └─ no hit                 → record dedup_signatures row + persist description_embedding → continue to triage
  → triage (Phase 2)
```

Intended outcomes: (a) recurring incidents collapse onto a single canonical ticket instead of fanning out; (b) LLM cost on the duplicate path drops to zero; (c) vector candidates become an audit trail downstream consumers can act on without committing the linkage in the row itself.

## 2. Locked Decisions for This Plan

1. **Delivery unit:** three PRs (see Section 4). The single-PR option is unreviewable at this surface area.
2. **`BL-004` resolution:** **Hybrid action.** Deterministic hash hit → **hard link** (`duplicate_of` set, `status='duplicate'`, skip triage and Linear push). Vector similarity hit (no deterministic hit) → **soft flag** (emit `ticket_events.deduplicated` with `detection='vector_similarity'` and `candidate_canonical_ticket_id` in the payload; do **not** set `duplicate_of` or change `status`). The row-level `duplicate_of` field is reserved for high-confidence deterministic links so its semantics stay unambiguous.
3. **`BL-005` resolution:** **Per-org, DB-stored, default 90 days.** A new `org_settings` table holds `dedup_window_days`. NULL in the row (or missing row) means "use system default 90."
4. **`BL-006` resolution:** **Per-org, DB-stored.** `org_settings.vector_dedup_enabled boolean DEFAULT false`. The dev seed enables vector dedup for the seed org so the path gets exercised in local dev; production orgs opt-in.
5. **`BL-007` resolution:** **OpenAI `text-embedding-3-large`, output truncated to 1536 dimensions** via OpenAI's `dimensions` request parameter (Matryoshka representation). 1536 fits the standard pgvector `vector` HNSW index ceiling of 2000 and preserves the bulk of large-model quality. Embedding generation goes through a new `getEmbeddingModel()` factory in `services/providers/ai/client.ts` keyed on `OPENAI_API_KEY`.
6. **Dimensionality decision is reversible:** if recall ends up too weak at 1536, the fallback is `halfvec(3072)` + HNSW (a single ALTER + reindex) — captured under Section 7.
7. **Vector index type:** **HNSW** (`vector_cosine_ops`) over IVFFlat. Better recall at low write volume and the dim range we are using; tuning parameters (`m`, `ef_construction`) start at pgvector defaults.
8. **Schemaless `ticket_events` payloads continue** per architecture §"event ledger". `deduplicated` payload shape is documented in Stage P3.4 but not enforced at the DB.
9. **Dedup runs inline in `createTicketFeature`, not as a separate API call.** The architecture pipeline is single-shot. A retry path covers transient failure.
10. **Retry dispatcher extension:** `retryTicketTriageFeature` gains two new branches (Stage P3.5). The function keeps its name in Phase 3 for callsite stability; an architectural rename is out of scope.
11. **Migrations follow `AGENTS.md` §12** with the in-day sequence prefix established in Phase 1 (`YYYY-MM-DD_NN_<description>.sql`). Phase 3 migrations begin at `2026-05-14_09_*`.

## 3. Scope Split

### In Scope (Now)

- Four SQL migrations: `org_settings` table + RLS, `description_embedding` dimension constraint + HNSW index, `find_similar_tickets` RPC function, dev seed extension.
- Two new Supabase Provider domains: `orgSettings`, `dedupSignatures`.
- Extension of the existing `tickets` Provider with one method to write dedup state (`updateDedupState` — sets `dedup_signature`, `description_embedding`, `duplicate_of`, `status` atomically; nullable inputs supported).
- AI Provider gains `generateEmbedding(text)` backed by OpenAI; existing Gemini classification path untouched.
- New `services/features/dedup/` Feature implementing the hybrid action.
- `createTicketFeature` rewired to call dedup before triage. Vector path only blocks triage when explicitly resolved as a deterministic hit.
- `retryTicketTriageFeature` extended with dedup retry branches.
- API DTO and dashboard surface a minimal `dedupStatus` field so the duplicate state is visible to callers.
- Tests across Provider, Feature, route, and embedding-mock paths; coverage ≥ 80%.

### Out of Scope (Later Phases)

- Linear push behavior on duplicates. Phase 4 decides whether duplicates push at all; this plan only ensures we *can* skip the push by returning a `status='duplicate'` row.
- Confirmation-email behavior on duplicates. Phase 6.
- Surfacing a "merge into canonical" UI action. Out of v1.
- Per-org admin UI to edit `org_settings`. v1 manages settings via SQL.
- Cross-org dedup. **Not a feature.** Cross-org leakage is a critical bug.
- Re-embedding historical rows after a model change. v1 does not include backfill jobs.

## 4. Commit and PR Strategy

Three PRs:

| PR | Stage group | Boundary rationale |
| --- | --- | --- |
| PR 1 | P3.1 + P3.2 | Schema, types, and Supabase Provider domains land together. Repo stays green; no Feature wiring yet, so `createTicketFeature` behavior is unchanged. |
| PR 2 | P3.3 + P3.4 | OpenAI embedding Provider extension + standalone Dedup Feature. Feature is callable but not yet invoked from the create pipeline. Tests prove the Feature works in isolation. |
| PR 3 | P3.5 + P3.6 + P3.7 | Pipeline integration, retry-dispatcher extension, DTO/dashboard surface, full verification + roadmap checkbox updates. Behavior change visible to callers. |

Each PR contains its stage's checklist updates in the same diff. Every PR references the Phase 3 Linear issue (to be created at greenlight).

## 5. Execution Stages and Mandatory Checklist

### Stage P3.1 — SQL Migrations + Type Regeneration

Goal: schema affordances for `org_settings` and indexed `description_embedding` exist in the dev Supabase project, with regenerated TypeScript types.

- [x] Author `migrations/2026-05-14_09_create_org_settings_table.sql` (`id uuid PK`, `org_id uuid NOT NULL UNIQUE FK → orgs(id) ON DELETE CASCADE`, `dedup_window_days int NULL` *(NULL = system default 90)*, `vector_dedup_enabled boolean NOT NULL DEFAULT false`, timestamps, soft-delete). Include a `CHECK (dedup_window_days IS NULL OR dedup_window_days > 0)`. Index on `org_id` is satisfied by the unique constraint.
- [x] Author `migrations/2026-05-14_10_constrain_description_embedding.sql`: (a) `ALTER TABLE tickets ALTER COLUMN description_embedding TYPE vector(1536) USING NULL`, (b) `CREATE INDEX tickets_description_embedding_hnsw_idx ON tickets USING hnsw (description_embedding vector_cosine_ops) WHERE description_embedding IS NOT NULL AND deleted_at IS NULL`. Include a top-of-file comment locking the 1536-dim decision and noting the `halfvec(3072)` fallback path.
- [x] Author `migrations/2026-05-14_11_enable_rls_org_settings.sql`: `ALTER TABLE org_settings ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`; SELECT/INSERT/UPDATE/DELETE policies keyed on `(auth.jwt() ->> 'org_id')::uuid = org_id` — mirror the `dedup_signatures` policies in `migrations/2026-05-13_08_enable_rls_and_policies.sql`.
- [x] Author `migrations/2026-05-14_12_create_find_similar_tickets_fn.sql`: a Postgres function `find_similar_tickets(p_org_id uuid, p_query_embedding vector(1536), p_window_days int, p_similarity_threshold float, p_limit int) RETURNS TABLE(ticket_id uuid, similarity float)`. Body executes the cosine-similarity query with an explicit `org_id` predicate (see Stage P3.2 for the exact SQL). `SECURITY INVOKER` so RLS still applies if ever called from a JWT context. `GRANT EXECUTE` to `authenticated` and `service_role`.
- [x] Extend `migrations/dev/2026-05-13_seed_dev_default.sql` (or create `migrations/dev/2026-05-14_seed_org_settings.sql` to keep the original seed immutable) to insert a row for the seed ATD-internal org with `vector_dedup_enabled = true` so the local dev path exercises the vector branch.
- [x] Apply migrations in order to the dev Supabase project (`mhpbpiuuttstzacqtsse`).
- [x] Run `pnpm gen-types`. Confirm `org_settings` appears in `assets/databaseTypes.ts` and `description_embedding` is typed as a 1536-dim vector (it will still be `string | null` in TS — pgvector vectors serialize as strings through Supabase's client; downstream Provider methods parse and format).
- [x] Verify `pnpm typecheck` is clean before merging PR 1.

Exit criteria:

- Four production migrations + one dev seed migration applied successfully.
- `description_embedding` column rejects vectors of dimension ≠ 1536 at the DB layer.
- `assets/databaseTypes.ts` knows about `org_settings`.
- Repo typechecks.

### Stage P3.2 — Supabase Provider Domains

Goal: Provider-layer access patterns for org settings and dedup signatures, plus the dedup-state write on `tickets`. Every method requires `orgId`.

- [x] Create `services/providers/supabase/domains/orgSettings.ts` exporting `OrgSettingsRow`, `OrgSettingsSource`, `makeOrgSettings`:
  - `getByOrg({ orgId })` → returns the row or `null`. Used by the Feature to read `dedup_window_days` and `vector_dedup_enabled`.
  - **No `upsert`** in this phase — settings are managed by the dev seed (and, in future, an admin path). Keeping the surface minimal avoids accidental writes.
- [x] Create `services/providers/supabase/domains/dedupSignatures.ts` exporting `DedupSignatureRow`, `DedupSignaturesSource`, `makeDedupSignatures`:
  - `findByNormalizedSignature({ orgId, normalizedSignature, windowDays })` → returns the latest `DedupSignatureRow` whose `created_at >= now() - windowDays * interval '1 day'`, or `null`. Always `.eq('org_id', orgId)`.
  - `findSimilarTickets({ orgId, queryEmbedding, windowDays, similarityThreshold, limit })` → returns `Array<{ ticketId: string; similarity: number }>`. Calls the `find_similar_tickets` RPC defined in Stage P3.1 migration `2026-05-14_12`. Function body SQL: `SELECT id, 1 - (description_embedding <=> $query) AS similarity FROM tickets WHERE org_id = $1 AND description_embedding IS NOT NULL AND deleted_at IS NULL AND created_at >= now() - $window * interval '1 day' AND duplicate_of IS NULL AND 1 - (description_embedding <=> $query) >= $threshold ORDER BY description_embedding <=> $query LIMIT $limit`. Provider passes args through `.rpc('find_similar_tickets', { ... })`.
  - `create({ orgId, normalizedSignature, canonicalTicketId })` → inserts a row. Composite FK to `tickets(id, org_id)` enforces same-org canonical at the DB layer.
- [x] Extend `services/providers/supabase/domains/tickets.ts` with `updateDedupState`:
  - Signature: `({ orgId, ticketId, update: { dedupSignature, descriptionEmbedding, duplicateOf, status } })` where each field is optional/nullable to support partial writes.
  - Always `.eq('id', ticketId).eq('org_id', orgId)`.
  - `descriptionEmbedding` is accepted as `number[]` and serialized to the pgvector text format (`'[v1,v2,...]'`) inside the method; Provider hides the wire format from the Feature.
- [x] Wire `orgSettings` and `dedupSignatures` into `services/providers/supabase/server.ts` `ServerSources` and `wireServer()`. Mirror the existing pattern.
- [x] Add Provider-domain tests:
  - `tests/unit/orgSettingsDomain.test.ts` — `getByOrg` returns row, returns null when row missing, applies org filter.
  - `tests/unit/dedupSignaturesDomain.test.ts` — `findByNormalizedSignature` respects org + window, `create` rejects cross-org canonical (mocked DB error path), `findSimilarTickets` passes through `.rpc` args correctly.
  - `tests/unit/ticketsUpdateDedup.test.ts` — `updateDedupState` writes the four fields, applies org predicate, vector serialization matches `'[a,b,c]'` shape.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` green.

Exit criteria:

- `server.tickets.updateDedupState`, `server.orgSettings.getByOrg`, `server.dedupSignatures.{findByNormalizedSignature, findSimilarTickets, create}` exist and are unit-tested.
- No new query in this stage omits an `org_id` predicate.

### Stage P3.3 — OpenAI Embedding in the AI Provider

Goal: `ai.generateEmbedding(text)` works against OpenAI without disturbing the Gemini classification path.

- [x] Add `@ai-sdk/openai` to dependencies via `pnpm add @ai-sdk/openai`.
- [x] Extend `services/providers/ai/client.ts`:
  - Add `DEFAULT_EMBEDDING_MODEL_ID = 'text-embedding-3-large'` and `DEFAULT_EMBEDDING_DIMENSIONS = 1536`.
  - Add `getEmbeddingModel()` that reads `OPENAI_API_KEY`, throws a clear error when missing (matching the Gemini pattern), and returns the `openai.embedding(modelId, { dimensions })` instance. Honor `AI_EMBEDDING_MODEL` and `AI_EMBEDDING_DIMENSIONS` env overrides.
  - Keep `getTriageModel()` unchanged.
- [x] Extend `services/providers/ai/index.ts` `AiProvider` type with `generateEmbedding(text: string): Promise<number[]>`. Implementation uses `embed({ model: getEmbeddingModel(), value: text })` from the `ai` package and returns `result.embedding`. Validate the returned length matches `DEFAULT_EMBEDDING_DIMENSIONS`; throw `EMBEDDING_DIMENSION_MISMATCH` on mismatch.
- [x] Add `OPENAI_API_KEY`, `AI_EMBEDDING_MODEL` (optional, default `text-embedding-3-large`), `AI_EMBEDDING_DIMENSIONS` (optional, default `1536`) to `.env.local.example` with explanatory comments.
- [x] Tests in `tests/unit/aiProvider.test.ts` (extend the existing file):
  - `generateEmbedding` returns the SDK embedding when configured correctly.
  - Missing `OPENAI_API_KEY` raises the expected error.
  - Dimension mismatch (mock SDK returns 768-length array) raises `EMBEDDING_DIMENSION_MISMATCH`.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` green.

Exit criteria:

- `ai.generateEmbedding` callable; produces a 1536-length `number[]`.
- Gemini classification path is byte-identical to its Phase 2 state.
- Env-var docs updated.

### Stage P3.4 — Dedup Feature

Goal: a standalone `services/features/dedup/` Feature that, given an `orgId` + `ticketId` + raw `subject`/`description`, returns a typed outcome and persists dedup state. Not yet wired into `createTicketFeature`.

- [x] Create:
  - `services/features/dedup/signatures.ts` — `normalize(subject, description)` (lowercase, trim, collapse whitespace, strip punctuation), `hashNormalized(normalized)` (SHA-256 hex via Node's `crypto.subtle` or `crypto.createHash`). Pure functions, fully unit-tested.
  - `services/features/dedup/config.ts` — `DEFAULT_DEDUP_WINDOW_DAYS = 90`, `VECTOR_SIMILARITY_THRESHOLD = 0.92`, `VECTOR_QUERY_LIMIT = 5`. Single source of truth for tunables.
  - `services/features/dedup/DedupStrategy.ts` — TS `interface DedupStrategy { run(input): Promise<DedupOutcome> }` plus the `DedupOutcome` discriminated union (`{ kind: 'no_hit' } | { kind: 'deterministic_hit'; canonicalTicketId: string } | { kind: 'vector_hit'; candidateCanonicalTicketId: string; similarity: number }`).
  - `services/features/dedup/deterministicHash.ts` — strategy implementation. Computes signature via `normalize` + `hashNormalized`, calls `sources.dedupSignatures.findByNormalizedSignature` scoped to org and window. Returns `deterministic_hit` or `no_hit`.
  - `services/features/dedup/vectorSimilarity.ts` — strategy implementation. Calls `ai.generateEmbedding(description)`, then `sources.dedupSignatures.findSimilarTickets` scoped to org/window/threshold. Returns `vector_hit` on the top match or `no_hit`. Also returns the generated embedding so the orchestrator can persist it without a second API call.
  - `services/features/dedup/dedupTicket.ts` — orchestrator `dedupTicketFeature({ orgId, ticketId, subject, description })`:
    1. Validate input with Zod (org/ticket UUIDs, subject/description non-empty).
    2. Read `org_settings` to determine `dedupWindowDays` (fallback 90) and `vectorDedupEnabled` (fallback false).
    3. Run deterministic strategy. On `deterministic_hit`: `sources.tickets.updateDedupState({ duplicateOf, status: 'duplicate', dedupSignature })` (no embedding), emit `ticket_events.deduplicated` with payload `{ detection: 'deterministic_hash', canonical_ticket_id, window_days }`, return `{ kind: 'deterministic_hit', ... }`.
    4. Else if vector dedup enabled: run vector strategy. On `vector_hit`: emit `ticket_events.deduplicated` with payload `{ detection: 'vector_similarity', candidate_canonical_ticket_id, similarity_score, window_days }`, persist the embedding and signature via `updateDedupState({ dedupSignature, descriptionEmbedding })` but **leave `duplicate_of` and `status` untouched** (per `BL-004` hybrid resolution). Return `vector_hit`.
    5. Else (`no_hit`): `sources.dedupSignatures.create({ ... })` to record the new canonical signature, persist the embedding (if generated) and signature via `updateDedupState`, return `no_hit`.
    6. Map all Provider/AI errors to `FeatureError`s (`DEDUP_LOOKUP_FAILED`, `EMBEDDING_FAILED`, `DEDUP_PERSIST_FAILED`, `VALIDATION_ERROR`).
  - `services/features/dedup/index.ts` — barrel exports.
- [x] Tests in `tests/unit/dedupTicket.test.ts`:
  - Deterministic exact match → returns `deterministic_hit`, sets `duplicate_of` + `status='duplicate'`, emits one `deduplicated` event with `detection='deterministic_hash'`.
  - Deterministic near-miss (different whitespace/punctuation but normalizes identically) → still hits.
  - Vector hit only (deterministic returns null, vector returns above threshold) → emits `deduplicated` with `detection='vector_similarity'`, does NOT modify `duplicate_of` or `status`, persists the embedding.
  - Vector threshold edge (similarity exactly at threshold counts as hit; just below does not).
  - No hit → creates `dedup_signatures` row, persists embedding (if generated), does not emit `deduplicated`.
  - Cross-org isolation → same subject/description in org A's history must not match a ticket inserted into org B.
  - Dedup window boundary → signature at the inside edge of the window matches; signature one day outside does not.
  - `vector_dedup_enabled=false` → vector strategy never runs; no embedding API call.
  - `org_settings` row missing → fallback defaults (90d window, vector off).
  - Embedding API failure on a vector-enabled org → returns `EMBEDDING_FAILED`; deterministic result still committed if it was a hit.
- [x] Tests for `signatures.ts` (`tests/unit/signatures.test.ts`): normalization edge cases, hash determinism, unicode handling.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` green.

Exit criteria:

- `dedupTicketFeature` callable as a unit, returns the typed outcome, never silently falls back to a default org.
- Coverage of `services/features/dedup/*` is ≥ 80% lines/branches/functions.

### Stage P3.5 — Pipeline Integration + Retry Dispatcher Extension

Goal: `createTicketFeature` runs dedup before triage and obeys the hybrid action; `retryTicketTriageFeature` re-runs dedup when state warrants.

- [x] Modify `services/features/tickets/ticketsFeatures.ts` `createTicketFeature` (after `received` emission, before the existing `triageTicketFeature` call):
  - Call `dedupTicketFeature({ orgId, ticketId: created.id, subject, description })`.
  - On `deterministic_hit`: refetch the ticket (it now has `status='duplicate'` and `duplicate_of` set) and return it. **Skip triage.**
  - On `vector_hit` or `no_hit`: continue to the existing inline-triage call. Triage operates on the row as today.
  - On dedup `FeatureError`: log, then continue to triage. Phase 3 follows the Phase 2 precedent — pipeline-step failures do not block the ticket from being created and triaged.
- [x] Modify `retryTicketTriageFeature` dispatcher:
  - Existing branch (`type IS NULL || status='failed'` → `triageTicketFeature`) preserved.
  - New branch: `status='duplicate'` → verify canonical via `sources.tickets.getById({ orgId, ticketId: ticket.duplicate_of })`. If canonical is gone (soft-deleted or missing), clear `duplicate_of` + reset `status='received'` via `updateDedupState`, then re-run dedup. If canonical still exists, treat as idempotent no-op.
  - New branch: `dedup_signature IS NULL && status='received'` → re-run dedup. Covers the case where the create-time dedup call hit a transient error and was logged-and-skipped.
  - Order branches so the triage retry runs only if neither dedup branch applies. Add inline comments explaining the dispatch order.
- [x] Tests in `tests/unit/ticketsFeatures.test.ts` (extend existing):
  - `createTicketFeature` deterministic hit path: ticket returned with `status='duplicate'`, triage Provider never called.
  - `createTicketFeature` vector hit path: triage Provider still called; returned ticket has the embedding persisted but `duplicate_of` null.
  - `createTicketFeature` dedup-error swallow: triage still runs; no error returned to caller.
- [x] Tests in `tests/unit/retryTicketTriage.test.ts` (extend existing):
  - `status='duplicate'` + canonical present → no-op.
  - `status='duplicate'` + canonical missing → re-dedup runs.
  - `status='received'` + `dedup_signature IS NULL` → re-dedup runs.
  - Existing triage-retry tests still pass.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` green.

Exit criteria:

- `createTicketFeature` behavior matches the diagram in Section 1.
- Retry dispatcher correctly routes for all four states (triage-needed, dedup-needed, duplicate-stale, idempotent).

### Stage P3.6 — API DTO + Dashboard Surface

Goal: the duplicate state is visible to API callers and to the dashboard reader.

- [x] Update `app/api/tickets/route.ts` and `app/api/tickets/[id]/retry-triage/route.ts` response serializers to include:
  - `dedupStatus`: `'unique' | 'duplicate'`. Derived: `duplicate_of && status==='duplicate'` → `'duplicate'`; all other rows → `'unique'`. Vector candidates remain event-log-only in Phase 3 because deriving them on list responses requires an extra event read.
  - `duplicateOf`: pass through `duplicate_of` when present.
  - Implementation choice: compute `dedupStatus` purely from the row (`'duplicate' | 'unique'`) and leave vector-candidate surfacing to a future dedicated read or denormalized field.
- [x] Update `components/tickets/types.ts` `Ticket` shape to include the new fields.
- [x] Update `components/tickets/TicketBadges.tsx` (or equivalent component) to render a "Duplicate" badge when `dedupStatus === 'duplicate'`. Visual styling can be minimal (Tailwind utility classes consistent with existing badges).
- [x] Update `components/tickets/TicketDetails.tsx` to show the canonical ticket ID (read-only text for v1, no link) when `duplicate_of` is set.
- [x] Tests:
  - `tests/unit/ticketsRoute.test.ts` extended: response shape includes `dedupStatus` for unique, duplicate, and vector-candidate fixtures.
  - Optional component test if the existing test layout supports it; otherwise rely on the route-shape test plus a manual smoke step in P3.7.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` green.

Exit criteria:

- API responses expose `dedupStatus` (and `duplicateOf` when set).
- Dashboard visually distinguishes duplicates from unique tickets.

### Stage P3.7 — Final Verification + Roadmap Update

Goal: green gates, coverage met, roadmap and architecture docs in sync.

- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` all green.
- [x] `pnpm exec vitest run --coverage` ≥ 80% across statements, branches, functions, lines.
- [x] Update `docs/DC/airiam-ticket-triage-roadmap.md`:
  - Check every Phase 3 execution-checklist box.
  - Check the Phase 3 box in the Master Progress Checklist.
  - Move `BL-004`, `BL-005`, `BL-006`, `BL-007` rows in the Decision Blockers Register to **Resolved 2026-05-14** with a one-line resolution summary each.
- [x] Update `docs/DC/airiam-ticket-triage-architecture.md`:
  - Open Questions register: append resolution notes for the four blockers.
  - Schema section: note the `description_embedding vector(1536)` constraint and HNSW index, plus the `org_settings` table addition.
- [ ] Manual smoke on `localhost:3000`:
  - Submit ticket A. Verify `dedupStatus='unique'`, triage runs.
  - Submit ticket A again (identical subject+description). Verify `dedupStatus='duplicate'`, `duplicateOf` matches A's id, no LLM call observed in logs.
  - Submit ticket B with similar but not identical wording. With vector dedup enabled, verify a `deduplicated` event exists with `detection='vector_similarity'` and triage still ran (row has `type` + `severity`).
- [x] Append a Closure section (mirror P1's Section 9) with verification evidence, coverage table, and deferred follow-ups.

Exit criteria:

- All four pre-PR gates green; coverage threshold met.
- Roadmap + architecture doc reflect Phase 3 completion and blocker resolutions.
- Manual smoke steps are documented and remain pending until run against `localhost:3000`.

## 6. Verification Commands

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm exec vitest run --coverage
```

Plus the manual smoke described in Stage P3.7 against `localhost:3000`.

## 7. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| 1536-dim Matryoshka-truncated embeddings degrade vector recall below useful levels | Medium | Tune `VECTOR_SIMILARITY_THRESHOLD` in `config.ts`; fall back path is `ALTER COLUMN description_embedding TYPE halfvec(3072)` plus an HNSW reindex. Single migration; existing rows can be re-embedded by toggling vector_dedup_enabled off and back on once a backfill job exists. |
| `find_similar_tickets` Postgres function drift between dev and future prod | Medium | Keep the function definition versioned in `migrations/` (not as an ad-hoc dashboard edit). Phase 9 hosting plan re-applies the migration set in prod. |
| Vector strategy's embedding API call adds latency to every ticket on vector-enabled orgs | Medium | Vector defaults to OFF per `BL-006`. Seed org turns it on for dev; production orgs opt-in. Embedding generation parallelizable with deterministic lookup later if hot. |
| `updateDedupState` racing with `updateTriage` produces inconsistent rows | Medium | Both write paths go through the Provider with explicit `org_id` predicate; dedup runs before triage in `createTicketFeature` (no concurrency in the happy path). Retry dispatcher serializes. Add a Provider-layer comment locking the ordering. |
| Soft-flag vector hits create an audit-only signal nobody acts on | Low | Phase 3 records the signal in `ticket_events.deduplicated`; surfacing it in list DTOs is deferred to avoid N+1 event reads. Future phases can promote a candidate to a confirmed duplicate or denormalize the candidate state. |
| OpenAI key leak through tests | Low | All embedding calls in tests mock `ai.generateEmbedding`. The real key only lives in `.env.local` (gitignored). `.env.local.example` ships with empty values. |
| Cross-org leakage via a forgotten `org_id` predicate in the new RPC | High | Treat the `find_similar_tickets` function body as a critical review item. Stage P3.4 tests include a cross-org isolation case. |

## 8. Acceptance Criteria (Phase 3 Done)

1. Migrations `2026-05-14_09` through `2026-05-14_12` exist, are applied to the dev Supabase project, and `assets/databaseTypes.ts` reflects them.
2. `services/providers/supabase/server.ts` exposes `orgSettings` and `dedupSignatures` domains; `tickets.updateDedupState` exists.
3. `ai.generateEmbedding(text)` returns a 1536-length `number[]` via OpenAI.
4. `services/features/dedup/` implements the hybrid action specified in `BL-004`.
5. `createTicketFeature` runs dedup before triage; deterministic hits skip triage; vector hits emit the audit event without changing `duplicate_of` or `status`.
6. `retryTicketTriageFeature` covers triage-retry, dedup-retry, and stale-duplicate cases.
7. API responses expose `dedupStatus` (and `duplicateOf` when set); the dashboard distinguishes the three outcomes visually.
8. All four pre-PR gates pass; coverage ≥ 80%.
9. Roadmap Phase 3 checklist fully checked; Master Progress Checklist Phase 3 box checked; `BL-004`–`BL-007` recorded as Resolved 2026-05-14 with one-line summaries.
10. Architecture doc's Open Questions register and schema section reflect Phase 3 changes.
11. Closure section in this plan filled in with verification evidence and any deferred follow-ups.

## 9. Closure (Stage P3.7 — 2026-05-14)

### Verification evidence

All four gates green on `feature/dedup-linear-lifecycle`:

```
pnpm lint                          → clean (eslint, no output)
pnpm typecheck                     → clean (tsc --noEmit, no output)
pnpm exec vitest run --coverage    → 173 passed / 173 (14 files)
pnpm build                         → success; routes: /, /dashboard, /api/tickets, /api/tickets/[id]/retry-triage
```

### Coverage summary

| | Stmts | Branch | Funcs | Lines |
|---|---|---|---|---|
| All files | 91.11% | 83.61% | 92.59% | 92.52% |
| `app/api/tickets/_dto.ts` | 100% | 100% | 100% | 100% |
| `app/api/tickets/route.ts` | 100% | 91.42% | 100% | 100% |
| `app/api/tickets/[id]/retry-triage/route.ts` | 100% | 100% | 100% | 100% |
| `services/features/dedup/*` | 90.14% | 85.71% | 100% | 91.17% |
| `services/features/tickets/ticketsFeatures.ts` | 94.73% | 79.62% | 100% | 94.28% |
| `services/providers/ai/*` | 97.56% | 95.45% | 100% | 100% |
| `services/providers/supabase/vectorEncoding.ts` | 100% | 100% | 100% | 100% |
| `services/providers/supabase/domains/dedupSignatures.ts` | 100% | 100% | 100% | 100% |
| `services/providers/supabase/domains/orgSettings.ts` | 100% | 100% | 100% | 100% |

Threshold `80%` met on every metric globally.

### Implementation summary

- **PR 1 (Stages P3.1 + P3.2):** four production SQL migrations + one dev seed (`org_settings` table, `description_embedding vector(1536)` + HNSW partial index, RLS, `find_similar_tickets` RPC); new Supabase Provider domains `orgSettings` + `dedupSignatures`; `tickets.updateDedupState` added; types regenerated.
- **PR 2 (Stages P3.3 + P3.4):** `@ai-sdk/openai` added; `ai.generateEmbedding(text)` wired to `text-embedding-3-large` with 1536-dim Matryoshka truncation; new `services/features/dedup/` Feature implementing the hybrid action (`BL-004`), reading per-org settings (`BL-005`, `BL-006`).
- **PR 3 (Stages P3.5 + P3.6 + P3.7):** `createTicketFeature` runs dedup before triage; deterministic hits skip triage; `retryTicketTriageFeature` extended with stale-duplicate-clear and missing-signature-rerun branches; shared `toTicketDto` helper surfaces `dedupStatus` and `duplicateOf`; dashboard badges and canonical-id display added; roadmap + architecture doc updated; blockers `BL-004`–`BL-007` marked Resolved.

### Notes on deferred follow-ups

- **Manual smoke** on `localhost:3000` — pending. Three flows to exercise: (a) unique ticket → triage runs, `dedupStatus='unique'`; (b) identical resubmit → `dedupStatus='duplicate'`, `duplicateOf` set, triage skipped; (c) similar-but-not-identical with vector enabled → triage runs, `ticket_events.deduplicated` row exists with `detection='vector_similarity'`.
- **`vector_candidate` DTO surface** — Phase 3 ships `dedupStatus: 'unique' | 'duplicate'` derived purely from row state. Exposing `'vector_candidate'` requires a `ticket_events` lookup per ticket which would N+1 the dashboard read; defer until there is a concrete UI consumer that justifies the extra round-trip (or a denormalized column).
- **Per-org admin UI to edit `org_settings`** — out of v1. Settings are managed by the dev seed and (eventually) by SQL or a future admin tooling path.
- **Vector recall calibration** — `VECTOR_SIMILARITY_THRESHOLD = 0.92` is a starting estimate. Once real ticket corpora exist, tune in `services/features/dedup/config.ts`. The fallback to `halfvec(3072)` + HNSW is a single ALTER + reindex away.
- **Concurrent canonical-refresh race on no-hit** — `dedup_signatures.create` upserts on `(org_id, normalized_signature)` so an expired or stale signature can be refreshed to a new canonical. Two simultaneous no-hit submissions for the same signature can still last-writer-wins the canonical pointer; a future enhancement can wrap lookup + canonical refresh in a DB function if this becomes material.
- **`createServerClient`/`createPublicClient` pruning** — still dead code from Phase 1; not load-bearing for Phase 3, deferred.

## 10. Change Policy

Any change to a locked item in Section 2 requires:

1. Explicit update in this file with a dated note.
2. Master roadmap update if the change affects Phase 3 scope or blocker resolution.
3. Architecture doc update if the change affects the schema, the pipeline ordering, or org-scoping invariants.

---

*Drafted 2026-05-14. Implementation closed out 2026-05-14 (Stage P3.7).*
