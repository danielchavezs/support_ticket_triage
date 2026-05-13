# DC P1 — Org/User Schema, Enums, RLS Plan

| Field | Value |
| --- | --- |
| Owner | Daniel Chávez (ATD) |
| Phase | Phase 1 (Org/User Schema, Enums, RLS) |
| Parent Plan | [`docs/DC/airiam-ticket-triage-roadmap.md`](./airiam-ticket-triage-roadmap.md) |
| Decision Baseline | `BL-001`, `BL-002`, `BL-003` (all resolved 2026-05-13) |
| Architecture Baseline | [`docs/DC/airiam-ticket-triage-architecture.md`](./airiam-ticket-triage-architecture.md) |
| Linear Issue | [AIR-194](https://linear.app/airiamspace/issue/AIR-194/phase-1-orguser-schema-enums-rls-migrations) |
| Status | Drafted, awaiting greenlight |
| Priority | P0 |

## 1. Purpose

Create the v1 database schema from scratch and rewrite the codebase to use it. No DB exists today; the forked-project migration was deleted in the alignment pass before this plan. Phase 1 lands the v1 tables, enums, and RLS policies, then updates the Provider/Feature/API layers to require org-scoped context on every operation. Phase 2 takes over from here to wire the triage pipeline against the new model.

## 2. Locked Decisions for This Plan

1. Delivery unit is **one PR per stage group** (see Section 4) rather than one PR for the whole plan. Phase 1 is large enough that a single PR would be unreviewable.
2. Six execution stages: P1.1 through P1.6.
3. Checklist maintenance is mandatory during implementation. Every stage's boxes are checked in the PR that lands the work, plus the corresponding boxes in the master roadmap.
4. Migration files follow `AGENTS.md` §12 (`YYYY-MM-DD_<short_description>.sql`), extended with an in-day sequence prefix (`YYYY-MM-DD_NN_<description>.sql`) to guarantee dependency order when multiple migrations land on the same date.
5. Migrations are applied to a fresh Supabase project owned by the developer running the work; production application is not part of Phase 1.
6. RLS policies live in a dedicated migration (`enable_rls_and_policies.sql`), not inline in each table's `CREATE`. Reviewable as one cohesive policy surface.
7. `pgvector` is enabled in a dedicated extensions migration that runs first.
8. Phase 1 creates `description_embedding` as unconstrained `vector`, with no vector index. Phase 3 chooses dimensionality/indexing after `BL-007` locks the embedding model.
9. The forked-project `byfqtbzdxpoxfjtwojbz` Supabase project ID in `package.json` `gen-types` is **not authoritative**. The developer applying Phase 1 may need to create a fresh project and update the script accordingly (or set up a per-environment project per the architecture doc).

## 3. Scope Split

### In Scope (Now)

- v1 SQL migration set (extensions, 5 table creations, RLS+policies).
- Dev-only seed script for a default `ATD-internal` org + dev user so the dashboard can keep functioning during development.
- Updated `services/providers/supabase/domains/*.ts` (tickets domain rewritten; new `orgs`, `users` domain modules added).
- Updated `services/features/tickets/ticketsFeatures.ts` to thread `org_id` + `user_id` through validation and persistence, while leaving triage fields nullable for Phase 2.
- Updated Zod schemas to the v1 `type` / `severity` enums.
- Skeleton `services/features/triage/priorityMatrix.ts` (no logic yet — populated in Phase 2).
- Updated `app/api/tickets/route.ts` to accept `org_id` and `user_id` from the caller (trust-on-assertion; HMAC verification comes in Phase 7).
- Updated `components/tickets/api.ts` and dashboard to send `org_id` / `user_id` (using the dev defaults from the seed).
- Test rewrites covering the new schema, the org-mismatch case (cross-org read returns empty), and the new validation paths.

### Out of Scope (Later Phases)

- Inline triage Feature consolidation into `services/features/triage/`. (Phase 2.)
- Deterministic priority matrix logic. (Phase 2.)
- Dedup behavior on the new `dedup_signatures` table. (Phase 3.)
- Linear push using new ticket shape. (Phase 4.)
- HMAC / cryptographic caller verification. (Phase 7.)
- Production-environment Supabase project provisioning. (Phase 9.)

## 4. Commit and PR Strategy

Three PRs total, each landing one stage group:

| PR | Stage group | Why this boundary |
| --- | --- | --- |
| PR 1 | P1.1 + P1.2 | Schema lands and types regenerate. This PR may merge only if the repo remains green; if regenerated DB types break application code, either include the minimal compatibility updates in PR 1 or defer type regeneration to PR 2. |
| PR 2 | P1.3 + P1.4 | Provider + Feature layers brought in line with new types. Code compiles and tests are updated enough to keep CI green. API/client contract may still use temporary dev defaults, but `dev` must not be broken. |
| PR 3 | P1.5 + P1.6 | API contract + client + tests aligned. Full path works end-to-end against the new schema. CI fully green. |

Each PR contains the stage's checklist updates in the same diff. Every PR references AIR-194.

## 5. Execution Stages and Mandatory Checklist

### Stage P1.1 — SQL Migrations Authored

Goal: write the SQL. Not applied yet.

- [x] Author `migrations/2026-05-13_01_enable_extensions.sql` (`CREATE EXTENSION IF NOT EXISTS vector`, `CREATE EXTENSION IF NOT EXISTS pgcrypto`).
- [x] Author `migrations/2026-05-13_02_create_enums.sql` (`CREATE TYPE ticket_type AS ENUM (...)`, `CREATE TYPE ticket_severity AS ENUM (...)`, `CREATE TYPE ticket_priority AS ENUM ('P1','P2','P3','P4')`, `CREATE TYPE ticket_status AS ENUM ('received','triaged','duplicate','pushed_to_linear','failed','closed')`, `CREATE TYPE ticket_source_kind AS ENUM ('in_app','aip_monitoring')`, `CREATE TYPE ticket_event_type AS ENUM ('received','triaged','deduplicated','pushed_to_linear','status_changed','email_sent','failed')`).
- [x] Author `migrations/2026-05-13_03_create_orgs_table.sql` (id uuid PK, name text not null, status text default 'active', timestamps, soft-delete).
- [x] Author `migrations/2026-05-13_04_create_users_table.sql` (id uuid PK, `org_id` uuid FK → orgs, email text not null, display_name text, timestamps, soft-delete). Add a unique expression index on `(org_id, lower(email))` for case-insensitive uniqueness. **No role column** (`BL-003`).
- [x] Author `migrations/2026-05-13_05_create_tickets_table.sql` (id uuid PK, `org_id` FK, `user_id` FK, `source_kind` enum, subject text not null, description text not null, `type` enum nullable, `severity` enum nullable, `priority` enum nullable, `status` enum default 'received', `confidence` numeric nullable, `customer_facing_summary` text nullable, `suggested_reply` text nullable, `dedup_signature` text nullable, `duplicate_of` self-FK nullable, `linear_issue_id` text nullable, `description_embedding vector` nullable, `triage_error` text nullable, timestamps, soft-delete). Do not choose vector dimension or index until `BL-007` is resolved in Phase 3.
- [x] Author `migrations/2026-05-13_06_create_ticket_events_table.sql` (id uuid PK, `org_id` FK, `ticket_id` FK, `event_type` enum, `payload` jsonb not null default `'{}'::jsonb`, created_at). Carrying `org_id` on events keeps RLS and common event-list queries simple; enforce ticket/org consistency with a composite FK or trigger.
- [x] Author `migrations/2026-05-13_07_create_dedup_signatures_table.sql` (id uuid PK, `org_id` FK, `normalized_signature` text not null, `canonical_ticket_id` FK → tickets, created_at, unique on `(org_id, normalized_signature)`). Enforce that `canonical_ticket_id` belongs to the same `org_id` via a composite FK or equivalent constraint.
- [x] Author `migrations/2026-05-13_08_enable_rls_and_policies.sql` (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY` on every org-scoped table; per-table SELECT/INSERT/UPDATE/DELETE policies keyed on `(auth.jwt() ->> 'org_id')::uuid = org_id`, with `orgs` scoped by `id = (auth.jwt() ->> 'org_id')::uuid`).
- [x] Author `migrations/dev/2026-05-13_seed_dev_default.sql` or an equivalent explicitly dev-only seed file (idempotent inserts for one `ATD-internal` org row and one dev user row, with stable known UUIDs surfaced via env vars). **Do not place this in the production migration chain.**
- [x] Add indexes for every FK column and planned hot access path: `users.org_id`, `tickets.org_id`, `tickets.user_id`, `tickets.created_at`, `tickets.duplicate_of`, `tickets.linear_issue_id`, `ticket_events.org_id`, `ticket_events.ticket_id`, `dedup_signatures.org_id`, `dedup_signatures.canonical_ticket_id`, plus partial indexes for non-deleted rows where useful.
- [x] Each SQL file has a top-of-file comment with purpose + idempotency notes + rollback notes (manual DROP path if reverting).

Exit criteria:

- Eight production SQL files exist in `migrations/`, plus one explicit dev-only seed file outside the production migration chain.
- Files parse with `psql --syntax-check` or equivalent (or, at minimum, the developer's local Supabase CLI accepts them).
- Each `CREATE TYPE` and `CREATE TABLE` is reviewed against the architecture doc's schema section.

### Stage P1.2 — Apply Migrations + Regenerate Types

Goal: schema exists in a real Supabase project; TypeScript types match.

- [ ] Create or designate a fresh dev Supabase project (if none exists).
- [ ] Update `package.json` `gen-types` script to point at the correct project ID, or document the override per-developer.
- [ ] Apply migrations in order via Supabase CLI (`supabase db push` or equivalent).
- [ ] Run `pnpm gen-types` to regenerate `assets/databaseTypes.ts`.
- [ ] Confirm the repo still typechecks (`pnpm typecheck`) before any PR merges. If regenerated DB types break the current domain layer, keep type generation local until PR 2 or add minimal compatibility edits in the same PR. Do not merge a PR with known typecheck failures.

Exit criteria:

- Schema in Supabase matches the SQL files.
- `assets/databaseTypes.ts` reflects the v1 tables, enums, and column types, or type regeneration is explicitly deferred to PR 2 with a note in this plan and the PR description.
- Seeded `ATD-internal` org and dev user rows exist with stable UUIDs in the developer's local/dev database only.

### Stage P1.3 — Provider Layer Rewrite

Goal: domain modules match the v1 schema; every query is org-scoped.

- [ ] Rewrite `services/providers/supabase/domains/tickets.ts`:
  - Drop `TicketCategory`, `TicketPriority` legacy types.
  - New types: `TicketRow`, `NewTicketRow`, `TicketTriageUpdate` reflecting v1 columns.
  - Every method (`list`, `getById`, `create`, `updateTriage`, etc.) **requires** `org_id` (and `user_id` where applicable) as an explicit parameter, applied as an equality predicate in the query.
  - No method silently returns cross-org data.
- [ ] Add `services/providers/supabase/domains/orgs.ts` with `getById`, `list`, `findByName` as needed.
- [ ] Add `services/providers/supabase/domains/users.ts` with `getById`, `findByEmail(orgId, email)`, `list(orgId)`.
- [ ] Update `services/providers/supabase/server.ts` to wire the new domain modules.
- [ ] Add a one-paragraph docstring at the top of `tickets.ts` documenting the org-scoping invariant.

Exit criteria:

- `pnpm typecheck` passes before this stage group merges. If Feature/API updates are needed to preserve that, include the minimum compatibility edits in the same PR.
- Code review confirms no Provider query references the `tickets`, `users`, `ticket_events`, or `dedup_signatures` tables without an `org_id` predicate.

### Stage P1.4 — Feature Layer Rewrite

Goal: business logic accepts and threads `org_id` / `user_id` end-to-end.

- [ ] Rewrite `services/features/tickets/ticketsFeatures.ts`:
  - `listTicketsFeature` now takes `{ orgId }`.
  - `createTicketFeature` takes `{ orgId, userId, ticket }` and emits `ticket_events.received` on success.
  - `retryTicketTriageFeature` takes `{ orgId, ticketId }`.
  - Validation expanded to require `orgId` and `userId` are valid UUIDs, the org exists, and the user belongs to that org.
- [ ] Add Zod schemas in a new `services/features/tickets/schemas.ts` (or update existing validation module) that validate the v1 input shape (org_id, user_id, subject, description, optional source_kind).
- [ ] Scaffold `services/features/triage/index.ts` and `services/features/triage/priorityMatrix.ts` — skeleton only, no logic. Phase 2 fills these in.
- [ ] Remove the legacy `performTriage` inline LLM call from `ticketsFeatures.ts` — leave a thin TODO comment pointing at Phase 2. The create-ticket Feature in Phase 1 inserts with `status = 'received'`, nullable triage fields left null, and no LLM call; the actual triage call moves to Phase 2.
- [ ] Update `services/features/tickets/index.ts` exports accordingly.

Exit criteria:

- `pnpm typecheck` passes.
- `pnpm test` may fail (tests still on legacy shape) — that's OK, fixed in Stage P1.6.
- No ticket Feature imports the LLM Provider for inline triage in Phase 1.

### Stage P1.5 — API Contract + Client Update

Goal: the create-ticket endpoint requires `org_id` / `user_id`, and the dashboard sends them.

- [ ] Update `app/api/tickets/route.ts`:
  - POST handler validates and extracts `org_id` and `user_id` from the request body.
  - 400 with normalized error if either is missing or not a UUID.
  - GET handler accepts `org_id` from a query parameter (`?orgId=...`) for v1.
  - Response shape uses the v1 fields (`type`, `severity`, `priority`, etc.).
- [ ] Update `app/api/tickets/[id]/retry-triage/route.ts` similarly — accept `org_id` (and verify the ticket belongs to it before triggering retry).
- [ ] Update `components/tickets/api.ts` to read the dev default org/user IDs from env vars (`NEXT_PUBLIC_DEV_ORG_ID`, `NEXT_PUBLIC_DEV_USER_ID`) and include them in every fetch. Add these to `.env.local.example` with the seeded UUIDs as values.
- [ ] Update `components/tickets/types.ts` to reflect the v1 response shape.
- [ ] Update the dashboard page (`app/dashboard/page.tsx` and any related components) to render the new fields. Where Phase 2 will populate `type`/`severity`/`priority` but Phase 1 leaves them null, render a placeholder ("not yet triaged") rather than crash.

Exit criteria:

- The submit flow on `/` posts a valid create request and receives a 201.
- The dashboard on `/dashboard` lists tickets scoped to the dev org and renders without errors.
- Manual smoke: submit a ticket, see it appear in the dashboard, retry triage works (even if it's a no-op in Phase 1).

### Stage P1.6 — Tests + Final Verification

Goal: green CI, coverage >= 80%, evidence captured.

- [ ] Rewrite `tests/unit/ticketsRoute.test.ts` for the v1 contract (org_id/user_id required, new response shape).
- [ ] Rewrite `tests/unit/ticketsFeatures.test.ts` for the v1 Feature signatures, including a cross-org-mismatch test (calling `listTicketsFeature({ orgId: A })` after seeding tickets for org B must return empty).
- [ ] Rewrite `tests/unit/retryTicketTriage.test.ts` for the new signature and org-scoping.
- [ ] Remove or rewrite `tests/unit/ticketTriage.test.ts` — depending on whether the LLM Provider call survives Phase 1 (most of its logic moves to Phase 2). Keep the env-var-missing test path.
- [ ] Add new test file `tests/unit/orgsUsersDomains.test.ts` covering the new domain modules' org-scoping behavior.
- [ ] Update `tests/unit/ticketCustomerReplyPrompt.test.ts` if the prompt builder's input type changed (likely yes — `priority` is now `P1..P4` and `category` is replaced by `type`).
- [ ] Verify `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` all pass.
- [ ] Verify `pnpm exec vitest run --coverage` passes with the configured 80% threshold.
- [ ] Update the master roadmap: check every Phase 1 execution-checklist box and the Master Progress Checklist Phase 1 box.
- [ ] Append a closure note to this plan (Section 9) with the executed command outputs.

Exit criteria:

- All four gates green locally and in CI.
- Coverage ≥ 80% across lines, branches, functions, statements.
- Cross-org isolation demonstrably enforced in tests.

## 6. Verification Commands

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm exec vitest run --coverage
```

Plus, manual smoke test on `localhost:3000`: submit a ticket through the form, confirm it appears in the dashboard, retry triage on it.

## 7. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Cross-org leakage via a forgotten `org_id` predicate | High | Mandatory cross-org isolation test in Stage P1.6. Code review checklist item: every Supabase query in the Provider must show an `org_id` predicate, and every user/ticket operation must prove user-org membership where relevant. |
| Vector dimension picked wrong; pgvector column has to be re-typed later | Medium | Phase 1 uses unconstrained `vector` and no vector index. Phase 3 locks dimensionality/indexing only after `BL-007` resolves. |
| Seed UUIDs leak as "magic constants" forever | Medium | Store them in env vars only; keep the seed file outside the production migration chain. Real org/user provisioning is post-v1. |
| API breaking change strands the dashboard mid-PR | Medium | PR 3 lands the API change + client update + tests in one diff so the dashboard never sits broken on `dev`. |
| `gen-types` script points at a stale Supabase project | Low | Stage P1.2 explicitly updates the script or documents the per-developer override. |

## 8. Acceptance Criteria (Phase 1 Done)

- Eight production migrations exist and are applied to a working Supabase project; the dev seed is applied only to local/dev.
- RLS is enabled on every org-scoped table with policies keyed on `auth.jwt() ->> 'org_id'`.
- `services/providers/supabase/domains/*` requires `org_id` (and `user_id` where applicable) on every operation; cross-org reads are demonstrably empty in tests.
- `services/features/tickets/*` threads `org_id` / `user_id` end-to-end and emits `ticket_events.received`.
- `app/api/tickets/route.ts` requires `org_id` and `user_id` in payloads; returns the v1 response shape.
- The dashboard renders v1 tickets without errors.
- All four pre-PR gates pass; coverage >= 80%.
- The master roadmap's Phase 1 box and every execution-checklist box are checked.
- This plan's Section 9 (Closure) is filled in with verification evidence.

## 9. Closure (filled in at Stage P1.6)

To be populated as the final PR lands. Include:

- Executed command output for each verification command.
- Coverage summary table.
- Notes on any deferred follow-ups or scope adjustments that came up during execution.

## 10. Change Policy

Any change to a locked item in Section 2 requires:

1. Explicit update in this file with a dated note.
2. Master roadmap update if the change affects Phase 1 scope.
3. Architecture doc update if the change affects the schema, enums, or org-scoping invariants.

---

*Drafted 2026-05-13. Awaiting greenlight before Stage P1.1 begins.*
