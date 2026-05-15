# Airiam Ticket Triage: Delivery Roadmap

## Status

- Version: `v0.1`
- Date: `2026-05-12`
- Owner: Daniel Chávez (Airiam Advanced Tech Division)
- Architecture baseline: [`docs/DC/airiam-ticket-triage-architecture.md`](./airiam-ticket-triage-architecture.md)
- Rules baseline: [`AGENTS.md`](../../AGENTS.md)

## Purpose

This document sequences the work required to deliver `airiam-ticket-triage` v1, in dependency order. It complements the architecture doc (which says *what* the system is) by describing *what gets built in what order, and what must be decided before each step starts*.

Two principles drive the structure:

1. **Decisions before implementation.** Open architectural questions that block a phase are surfaced in the Decision Blockers Register. A phase cannot start until its blockers are resolved. This avoids agents building on assumptions that later have to be ripped out.
2. **Mandatory progress tracking.** Every checkbox below is load-bearing. As work lands, the corresponding box is checked in the same PR. Coding agents must keep this file in sync; it is the canonical progress record.

Per-phase execution plans (with commit-level stage breakdowns) will be created at `docs/DC/P<N>-<phase-name>-plan.md` when each phase is activated. This roadmap stays at phase-and-checklist granularity.

If this roadmap conflicts with `docs/DC/airiam-ticket-triage-architecture.md`, the architecture document wins. Update both files in the same change set when phase sequencing exposes an architecture decision or scope shift.

## 0. Master Progress Checklist

- [x] **Phase 0** — Foundation Hygiene
- [x] **Phase 1** — Org/User Schema, Enums, RLS
- [x] **Phase 2** — Triage Pipeline Refactor
- [x] **Phase 3** — Deduplication (deterministic + vector)
- [ ] **Phase 4** — Linear Outbound (push)
- [ ] **Phase 5** — Linear Inbound Webhook
- [ ] **Phase 6** — Email Notifications
- [ ] **Phase 7** — Caller Authentication Hardening
- [ ] **Phase 8** — CI/CD and Pre-Deploy Gates
- [ ] **Phase 9** — Hosting and Live Validation
- [ ] **Phase 10** *(deferred, post-v1)* — AIP Monitoring Intake
- [ ] **v1 MVP Accepted**

---

## 1. Decision Blockers Register

Each blocker is a discrete decision that must land before the phase it gates can begin. Resolving a blocker means: a written decision recorded either in this register's "Resolution" field or as an inline update to the architecture doc, plus any required external setup (credentials provisioned, secrets created).

Agents must not implement past a blocker. If a phase looks blocked, stop, surface the open decision, and resume only after explicit resolution.

| ID | Decision | Gates Phase | Status | Owner | Resolution |
|---|---|---|---|---|---|
| `BL-001` | Priority matrix validated against ATD triage practice (or replaced) | Phase 1, Phase 2 | **Resolved 2026-05-13** | Daniel | Draft matrix approved as-is. Lands as `services/features/triage/priorityMatrix.ts` in Phase 2. |
| `BL-002` | `type` + `severity` enum values validated against ATD labelling practice | Phase 1, Phase 2 | **Resolved 2026-05-13** | Daniel | Both enums approved as-drafted. `type`: `bug \| feature \| improvement \| question \| incident`. `severity`: `blocker \| major \| minor \| trivial`. |
| `BL-003` | Role model on `users` table (admin / submitter / read-only / etc., or none for v1) | Phase 1 | **Resolved 2026-05-13** | Daniel | **No role column in v1.** Additive path preserved — adding a role column or `roles` table later is a future migration, documented in the architecture's Roadmap and Modularity Seams table. |
| `BL-004` | Dedup action on hit (reject, link, merge, soft-flag only) | Phase 3 | **Resolved 2026-05-14** | Daniel | Hybrid action. Deterministic hash hit = hard link (`duplicate_of` set, `status='duplicate'`, skip triage). Vector hit = soft flag (emit `ticket_events.deduplicated` only; row unchanged). |
| `BL-005` | Dedup time window (forever, 30d, 90d, per-org configurable) | Phase 3 | **Resolved 2026-05-14** | Daniel | Per-org configurable, default 90 days. New `org_settings.dedup_window_days` column (NULL = system default 90). |
| `BL-006` | Vector dedup default state (on, off, behind feature flag) | Phase 3 | **Resolved 2026-05-14** | Daniel | Per-org configurable, default off. New `org_settings.vector_dedup_enabled` boolean column. Dev seed enables it for the ATD-internal org. |
| `BL-007` | Embedding model for `pgvector` dedup (Gemini, Vertex AI, OpenAI, etc.) | Phase 3 | **Resolved 2026-05-14** | Daniel | OpenAI `text-embedding-3-large` truncated to 1536 dims via the `dimensions` API parameter (Matryoshka). Fits standard pgvector HNSW index ceiling; reversible to `halfvec(3072)` if recall demands. |
| `BL-008` | Linear API key + team ID provisioned for `dev` and `prod` environments | Phase 4 | Open | Daniel | — |
| `BL-009` | Email provider (Resend, Postmark, ACS, SendGrid, etc.) | Phase 6 | Open | Daniel | — |
| `BL-010` | Email sending domain + DNS records (SPF, DKIM, DMARC) | Phase 6 | Open | Daniel | — |
| `BL-011` | Customer-relevant Linear status-transition subset (which transitions trigger an email) | Phase 6 | Open | Daniel + ATD leads | — |
| `BL-012` | Caller authentication mechanism for in-app Source A (HMAC working assumption to be confirmed or replaced) | Phase 7 | Open | Daniel + Airiam app teams | — |
| `BL-013` | Hosting target finalization (Azure Container Apps assumed; not locked) | Phase 9 | Open | Daniel + DevOps | — |
| `BL-014` | AIP monitoring webhook contract (payload, auth, retry) | Phase 10 *(deferred)* | Open | Daniel + AIP team | Out of v1 scope |

Cross-reference: open questions 1–13 in [`airiam-ticket-triage-architecture.md`](./airiam-ticket-triage-architecture.md#open-questions-and-decision-register) map onto `BL-001` through `BL-014` above. Open questions 14 (legacy retention) and 15 (multi-agent skill sync) are not delivery blockers and remain doc-only items.

When a blocker is resolved, update its row in this register, append a one-line note to the architecture doc's Open Questions section, and check the corresponding box in the phase's prerequisites below.

---

## 2. Phase Definitions

Each phase has: goal, prerequisites (decision blockers and prior phases), execution checklist, exit criteria.

The checklists below are at task granularity, not stage-and-commit granularity. When a phase is activated, a dedicated `docs/DC/P<N>-*-plan.md` file is created that breaks the checklist into stages, commit checkpoints, and verification commands — same pattern as `design-team-rag/docs/DC/P1-0-Foundation-and-Contracts-Plan.md`.

### Phase 0 — Foundation Hygiene

**Goal:** bring the forked codebase into structural alignment with the architecture doc before any feature work, so subsequent phases do not fight legacy naming or layout.

**Prerequisites:** none. Phase 0 has no decision blockers.

**Execution checklist:**

- [x] Rename `services/sources/` to `services/providers/` (move files, update all imports, keep public exports stable).
- [x] Update `package.json` `name` from `support_ticket_triage` to `airiam-ticket-triage`.
- [x] Add a `typecheck` script to `package.json` (`"typecheck": "tsc --noEmit"`).
- [x] Create `.env.local.example` with every key in the env var table from `AGENTS.md` §10, no secret values.
- [x] Update the root README to defer to the architecture doc and roadmap as source of truth, and to point at `.env.local.example` instead of inlining env var instructions.
- [x] Verify `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` all pass.

**Exit criteria:**

- No code path imports from `services/sources/`.
- `package.json` reflects the project's real name and exposes `typecheck`.
- `.env.local.example` exists and lists every required key.
- All four local verification commands are green.

---

### Phase 1 — Org/User Schema, Enums, RLS

**Goal:** create the v1 schema from scratch — `orgs`, `users`, `tickets` (with the full v1 column set including `org_id`, `user_id`, `type`, `severity`, derived `priority`, embedding column), `ticket_events`, `dedup_signatures`, plus RLS on every org-scoped table. No DB exists yet; no ALTER or data migration is involved.

**Prerequisites:**

- [x] Phase 0 complete.
- [x] `BL-001` (priority matrix) resolved.
- [x] `BL-002` (`type` + `severity` enums) resolved.
- [x] `BL-003` (role model) resolved — no role column in v1.

**Execution checklist:**

- [x] Author migration: `2026-05-13_03_create_orgs_table.sql` (id, name, status, timestamps, soft-delete).
- [x] Author migration: `2026-05-13_04_create_users_table.sql` (id, `org_id` FK, email, display_name, timestamps, soft-delete, case-insensitive unique index on `(org_id, lower(email))`). **No role column in v1 per `BL-003`; additive migration when/if roles are introduced.**
- [x] Author migration: `2026-05-13_05_create_tickets_table.sql` (id, `org_id` FK, `user_id` FK, `source_kind`, raw subject/description, `type` (enum), `severity` (enum), derived/persisted `priority`, `status`, `dedup_signature`, `duplicate_of` same-org self-FK, `linear_issue_id`, `description_embedding vector` without dimension/index until Phase 3, timestamps, soft-delete). Created fresh from the v1 column set; no legacy `priority`/`category` columns exist.
- [x] Author migration: `2026-05-13_06_create_ticket_events_table.sql` (id, `org_id`, `ticket_id`, `event_type` enum, payload jsonb, created_at).
- [x] Author migration: `2026-05-13_07_create_dedup_signatures_table.sql` (id, `org_id`, `normalized_signature`, `canonical_ticket_id`, created_at, unique on `(org_id, normalized_signature)`, same-org constraint between signature and canonical ticket).
- [x] Author migration: `2026-05-13_08_enable_rls_and_policies.sql` (enable RLS on every org-scoped table; add per-table SELECT/INSERT/UPDATE policies keyed on `auth.jwt() ->> 'org_id'`; `authenticated` role grants for future user-JWT paths).
- [x] Apply all migrations to local Supabase project.
- [x] Regenerate Supabase types via `pnpm gen-types`.
- [x] Update `tickets` Provider methods so every query carries explicit `org_id` and `user_id` predicates (service-role bypasses RLS; explicit scoping is mandatory).
- [x] Update the create-ticket API to accept `org_id` and `user_id` from the caller (trust-on-assertion for now; cryptographic verification arrives in Phase 7).
- [x] Add `ticket_events.received` emission on every successful insert.
- [x] Replace legacy `priority`/`category` Zod schemas with new `type`/`severity` schemas. Add `priorityMatrix.ts` (matrix is locked data per `BL-001`; orchestrator wiring lands in Phase 2).
- [x] Tests: Feature-layer tests for org-scoped reads/writes covering the org-mismatch case (cross-org read must return empty); Provider-domain tests for `orgs`/`users` cover org-scoping at the query level.
- [x] Verify `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` all pass.

**Exit criteria:**

- New schema lives under `migrations/` and is applied cleanly locally.
- RLS is enabled on every org-scoped table.
- `tickets` Provider methods require trusted context and apply scoping in every query.
- The create-ticket endpoint accepts API `orgId` + `userId` fields and persists them as `org_id` + `user_id`.
- Cross-org reads are demonstrably blocked in tests.

---

### Phase 2 — Triage Pipeline Refactor

**Goal:** lift the inline triage logic out of `services/features/tickets/` into its own Feature, produce the new `{ type, severity, customer_facing_summary, suggested_reply, confidence }` LLM output, and apply the deterministic priority matrix.

**Prerequisites:**

- [x] Phase 1 complete.
- [x] `BL-001` (priority matrix) resolved.
- [x] `BL-002` (enums) resolved.

**Execution checklist:**

- [x] Create `services/features/triage/` with: `index.ts` (entry point), `triageTicket.ts` (orchestrator), `priorityMatrix.ts` (table lookup), `schemas.ts` (Zod output schema), `confidence.ts` (threshold logic).
- [x] Move triage orchestration out of `services/features/tickets/ticketsFeatures.ts` into the new `triage` Feature. `tickets` Feature retains persistence; `triage` returns a classified result.
- [x] Replace the legacy `priority` + `category` LLM output schema with the new `{ type, severity, customer_facing_summary, suggested_reply, confidence }` schema. Validate with Zod.
- [x] Implement `priorityMatrix[severity][type]` lookup as a pure function. No fallthrough; matrix is total.
- [x] Implement confidence-threshold flagging: below-threshold results return a `needs_human_triage: true` indicator on the ticket. *(Derived in API DTO as `needsHumanTriage` from `confidence < 0.70`; threshold lives in `services/features/triage/confidence.ts`.)*
- [x] Emit `ticket_events.triaged` on success and `ticket_events.failed` on LLM error.
- [x] Generalize the existing `retryTicketTriage` endpoint so it can resume from any failed step (not just LLM). *(State-aware dispatcher: re-runs triage when `type IS NULL` or `status='failed'`; idempotent no-op when already triaged. Future phases extend the dispatch table.)*
- [x] Tests: LLM happy path, schema validation rejection, retry path, below-confidence flagging, matrix lookup completeness.
- [x] Verify `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` all pass.

**Exit criteria:**

- `services/features/triage/` owns triage end-to-end; `tickets` no longer calls the LLM Provider.
- LLM output is validated with Zod and produces `type`, `severity`, `confidence`, `customer_facing_summary`, `suggested_reply`.
- `priority` is always derived from the matrix, never from the LLM.
- Below-confidence outputs are flagged.
- Retry works from any failed pipeline step.

---

### Phase 3 — Deduplication

**Goal:** implement both deterministic-hash and vector-similarity dedup behind a `DedupStrategy` interface, scoped to `org_id`, with the agreed action on hit.

**Prerequisites:**

- [x] Phase 2 complete.
- [x] `BL-004` (dedup action on hit) resolved.
- [x] `BL-005` (dedup window) resolved.
- [x] `BL-006` (vector default state) resolved.
- [x] `BL-007` (embedding model) resolved.

**Execution checklist:**

- [x] Create `services/features/dedup/` with `DedupStrategy.ts` interface, `deterministicHash.ts`, `vectorSimilarity.ts`, `dedupTicket.ts` orchestrator.
- [x] Implement subject+description normalization (lowercase, trim, collapse whitespace, strip punctuation).
- [x] Implement deterministic hash insert+lookup against `dedup_signatures`, scoped to `org_id`.
- [x] Add embedding generation Provider call (model per `BL-007`) and persist `description_embedding` on insert.
- [x] Implement cosine-similarity query scoped to `org_id` with configurable threshold.
- [x] Apply the `BL-004` action on hit (link only / merge / reject — implementation depends on resolution).
- [x] Apply the `BL-005` dedup window in the lookup query.
- [x] Honor the `BL-006` vector default state (env-toggled or hardcoded).
- [x] Emit `ticket_events.deduplicated` on hit.
- [x] Tests: deterministic-hash exact and near-miss, vector-similarity true positive and threshold-edge negative, cross-org isolation, window boundary.
- [x] Verify `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` all pass.

**Exit criteria:**

- Dedup runs inline before LLM classification (per architecture pipeline step 2).
- Both strategies are wired and respect `org_id` scoping.
- Action on hit, window, and vector-default behavior match the resolved blockers.

---

### Phase 4 — Linear Outbound (push)

**Goal:** push every triaged ticket as a new issue into the ATD Linear team's Triage queue, persisting the resulting Linear issue ID on the ticket row.

**Prerequisites:**

- [ ] Phase 2 complete.
- [ ] `BL-008` (Linear API key + team ID provisioned) resolved.

**Execution checklist:**

- [ ] Add `@linear/sdk` to dependencies.
- [ ] Create `services/providers/linear/` with `client.ts` (SDK wrapper) and `LinearProvider.ts` (Protocol-style interface).
- [ ] Implement `createIssue`, `updateIssue`, `getIssue`, and `verifyWebhookSignature` helper methods on the Provider (verify helper used by Phase 5).
- [ ] Create `services/features/linear-sync/` with `pushTicket.ts` and field-mapping logic per the architecture doc's mapping table.
- [ ] Wire `pushTicket` into the triage pipeline as step 6 (inline, after persist).
- [ ] Persist `linear_issue_id` on the ticket row; emit `ticket_events.pushed_to_linear`.
- [ ] Add transient-failure retry semantics (don't fail the whole submission if Linear is briefly unavailable; flag the ticket for retry).
- [ ] Tests: success, transient failure with retry, hard failure with manual-retry path, field-mapping correctness.
- [ ] Verify `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` all pass.

**Exit criteria:**

- Every triaged ticket lands in Linear (or is flagged for retry).
- `linear_issue_id` is persisted and visible from API responses.
- Transient failures don't lose tickets.

---

### Phase 5 — Linear Inbound Webhook

**Goal:** receive Linear status-change events, verify their signature, update the corresponding ticket row, and emit `ticket_events.status_changed`. Triggers the email Feature in Phase 6 (which will start empty in this phase).

**Prerequisites:**

- [ ] Phase 4 complete.

**Execution checklist:**

- [ ] Create `app/api/linear/webhook/route.ts`. Capture raw body and signature headers; pass through to the Feature.
- [ ] Create `services/features/linear-sync/handleWebhook.ts`.
- [ ] Feature calls `LinearProvider.verifyWebhookSignature` before mutating state. On failure, return a `FeatureError` mapped to HTTP 401.
- [ ] Lookup the ticket by `linear_issue_id`. If not found, log structured warning and return 200 (don't 404 — Linear retries).
- [ ] Apply the status transition to the ticket row.
- [ ] Emit `ticket_events.status_changed`.
- [ ] Add `LINEAR_WEBHOOK_SECRET` to env var docs and `.env.local.example`.
- [ ] Tests: signature pass, signature fail, unknown `linear_issue_id`, valid transition, duplicate delivery (idempotency on Linear's delivery-id header).
- [ ] Verify `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` all pass.

**Exit criteria:**

- Webhook endpoint exists, verifies signatures, and updates ticket state.
- Failed signatures return 401 with a normalized error.
- Duplicate deliveries are idempotent.
- The hook into `notifications` Feature exists as a no-op call (filled in Phase 6).

---

### Phase 6 — Email Notifications

**Goal:** send the submitter a confirmation on ticket intake and curated status-change emails when Linear transitions match the customer-facing subset.

**Prerequisites:**

- [ ] Phase 5 complete.
- [ ] `BL-009` (email provider) resolved.
- [ ] `BL-010` (sending domain + DNS) resolved.
- [ ] `BL-011` (status-transition subset) resolved.

**Execution checklist:**

- [ ] Add concrete email Provider implementation under `services/providers/email/` (per `BL-009`).
- [ ] Author submission-confirmation email template (subject, body, includes ticket reference + LLM-drafted reply + below-confidence notice when applicable).
- [ ] Author status-change email template per transition in the `BL-011` subset.
- [ ] Create `services/features/notifications/` with `sendConfirmation.ts` and `sendStatusChange.ts`.
- [ ] Wire `sendConfirmation` into the triage pipeline as step 7 (inline, after Linear push).
- [ ] Wire `sendStatusChange` into the Linear-webhook handler when the transition is in the `BL-011` subset.
- [ ] Emit `ticket_events.email_sent` on success and `ticket_events.failed` on hard failure.
- [ ] Configure SPF/DKIM/DMARC for the sending domain (`BL-010`).
- [ ] Add `EMAIL_PROVIDER_API_KEY` and `EMAIL_SENDER` to env docs and `.env.local.example`.
- [ ] Tests: confirmation send success, transient failure handling, status-change subset filter, template-rendering correctness.
- [ ] Verify `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` all pass.

**Exit criteria:**

- Submitters receive confirmation emails inline with ticket creation.
- Submitters receive status-change emails for the `BL-011` subset only.
- DNS for the sending domain is set up.

---

### Phase 7 — Caller Authentication Hardening

**Goal:** replace trust-on-assertion of `org_id` / `user_id` with cryptographic verification of the calling Airiam app (BDT, AIP, future apps).

**Prerequisites:**

- [ ] Phase 1 complete.
- [ ] `BL-012` (caller auth mechanism) resolved.

**Execution checklist:**

- [ ] Implement the resolved auth mechanism in a Feature-layer middleware (`services/features/auth/verifyCaller.ts`) called from every API route handler under `app/api/*` that takes external input.
- [ ] If HMAC (working assumption): build per-caller shared-secret config (map of `caller_id -> { secret, allowed_orgs }`), 5-minute timestamp window, replay protection via in-memory or Supabase-backed nonce store.
- [ ] If token-based: integrate the chosen token issuer/validator.
- [ ] Reject requests whose asserted `org_id` is not in the caller's allowed-orgs list.
- [ ] Add `IN_APP_CALLER_HMAC_SECRET` (or equivalent) to env vars and `.env.local.example`.
- [ ] Update API error contract so verification failures return 401 with a normalized error code.
- [ ] Tests: valid signature, invalid signature, expired timestamp, replay rejection, cross-org assertion rejection.
- [ ] Update calling-app integration docs (snippet of how BDT/AIP must sign their requests).
- [ ] Verify `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` all pass.

**Exit criteria:**

- All v1 API write endpoints reject unsigned or invalidly signed requests.
- Cross-org assertion attempts are rejected even with a valid caller signature.
- Integration documentation exists for calling apps.

---

### Phase 8 — CI/CD and Pre-Deploy Gates

**Goal:** automate the local-verification gates in CI, enforce coverage thresholds, and prepare deployment pipelines. Can run in parallel with Phases 4–7 as soon as Phase 0 lands.

**Prerequisites:**

- [ ] Phase 0 complete.

**Execution checklist:**

- [x] Create `.github/workflows/ci.yml`: on push or PR to `dev`/`main`, run `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm build` (quality job), and `pnpm exec vitest run --coverage` (tests job). Structure mirrors the EFT support bot pattern (separate quality + tests jobs).
- [x] Add Vitest coverage configuration and the required coverage provider dependency (`@vitest/coverage-v8`, pinned to the exact vitest version to avoid peer drift). Enforce **80%** minimum on lines, branches, functions, statements via `vitest.config.ts` `coverage.thresholds`.
- [x] Add `.github/workflows/claude.yml` (Anthropic Claude Code action) replicating the EFT support bot template. Requires `ANTHROPIC_API_KEY` secret in the repo settings.
- [ ] Add a coverage-report comment step on PRs (optional but recommended).
- [ ] Add secret-scanning to the CI workflow (e.g., `gitleaks` or GitHub native).
- [ ] Create `.github/workflows/deploy-dev.yml`: on merge to `main`, deploy to deployed-dev. *(Deployment step is stubbed until Phase 9 finalizes hosting.)*
- [ ] Create `.github/workflows/deploy-prod.yml`: manual `workflow_dispatch` only, requires `prod` environment approval.
- [ ] Ensure agent-authored PRs cannot self-approve (branch protection on `dev` and `main` requires human review). **GitHub repo-settings UI action; not a CI workflow change.**
- [ ] Document the workflow in `AGENTS.md` §8 if anything changes from the current branching rules.
- [ ] Verify a sample PR exercises all gates green.

**Exit criteria:**

- Every PR runs lint, typecheck, test, build, and coverage in CI.
- Coverage below 70% fails the check.
- Secret scans run on every PR.
- Deploy workflows exist (even if hosting step is stubbed).
- No agent can approve a PR.

---

### Phase 9 — Hosting and Live Validation

**Goal:** stand up deployed dev and deployed prod environments, wire the deploy workflows from Phase 8 to the chosen hosting target, and validate the full pipeline live.

**Prerequisites:**

- [ ] Phase 8 complete.
- [ ] All v1 feature phases complete (1–7).
- [ ] `BL-013` (hosting target) resolved.

**Execution checklist:**

- [ ] Provision `deployed-dev` Supabase project + Linear API key + email provider key. Apply all migrations.
- [ ] Provision `deployed-prod` Supabase project + Linear API key + email provider key. Apply all migrations.
- [ ] Build the production container image (or chosen artifact format) per `BL-013`.
- [ ] Configure the chosen hosting service (Azure Container Apps assumed) for both environments with environment-scoped secrets.
- [ ] Wire Phase 8's `deploy-dev.yml` and `deploy-prod.yml` to the live hosting target.
- [ ] Live smoke tests in `deployed-dev`: end-to-end ticket submission, triage, dedup, Linear push, confirmation email, Linear webhook → status-change email.
- [ ] Live smoke tests in `deployed-prod`: same suite against prod data path.
- [ ] Verify production secrets are not accessible from dev contexts.
- [ ] Verify Supabase data does not cross environments.
- [ ] Capture screenshots / logs of each live verification in the per-phase plan doc.

**Exit criteria:**

- Both environments are running on the chosen hosting target with separate Supabase projects and separate Linear keys.
- Full end-to-end happy-path works in both environments.
- Webhook-driven status emails work in both environments.
- Secret isolation between dev and prod is verified.

---

### Phase 10 — AIP Monitoring Intake *(deferred, post-v1)*

**Goal:** add the AIP-monitoring webhook as a second intake source, normalized through the same triage pipeline.

**Prerequisites:**

- [ ] v1 MVP accepted.
- [ ] `BL-014` (AIP webhook contract) resolved.
- [ ] AIP is shipped and emitting incident-shaped events.

**Status:** explicitly out of v1 scope. This phase exists in the roadmap so the seam (Provider + Feature directory layout in the architecture doc) is preserved, not so the work is started early.

---

## 3. Testing and Quality Gates

Minimum pre-PR gates (enforced locally and in CI from Phase 8 onward):

- `pnpm lint`
- `pnpm typecheck` (or `pnpm exec tsc --noEmit` until the alias exists)
- `pnpm test` (`pnpm test --coverage` once Phase 8 configures coverage)
- `pnpm build`

Coverage thresholds: 80% minimum across lines, branches, functions, statements (CI-enforced via `vitest.config.ts`).

Priority test surfaces (called out in `AGENTS.md` §9 too):

- Triage Feature: classification handling, fallback, retry, confidence flagging.
- Dedup Feature: deterministic collisions, vector threshold, org isolation, window edges.
- Linear push Feature: success, transient failure, retry.
- Linear webhook: signature verification (positive and negative), idempotency.
- Caller auth: signature verification, replay, cross-org rejection.
- RLS-relevant DB access: cross-org isolation under both service-role (explicit scoping) and future user-JWT paths.
- Email Feature: confirmation send, status-change subset filter.

## 4. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Decision blockers go unresolved and phases stall | High | Surface in this register every status update; refuse to implement past a blocker. |
| Service-role bypass of RLS leads to cross-org leakage | High | Mandatory explicit `org_id` predicates in every Provider query, enforced via Feature-layer tests for cross-org reads. |
| Legacy v1.1 spec leaks back into v1 scope through agent confusion | Medium | `docs/requirements/legacy/` is reference-only; architecture doc + this roadmap take precedence per `AGENTS.md` §1. |
| Email or Linear flakiness fails the inline triage pipeline | Medium | Inline pipeline preserves recoverable state on failure; manual-retry endpoint exists from Phase 2 onward. |
| Vector dedup produces false positives that hide real tickets | Medium | Deterministic hash is the gating check. Keep vector behavior aligned with `BL-004` and `BL-006`; default to soft-flagging unless Daniel explicitly locks a stricter action. |
| Hosting decision changes mid-build and invalidates deploy work | Medium | Phase 8 stubs the deploy step; Phase 9 binds it only after `BL-013` is locked. |
| Caller auth assumption (HMAC) is wrong | Low | Phase 7 implementation gates on `BL-012` resolution; until then API trusts asserted context, which is acceptable for internal-only callers in dev/staging. |

## 5. Definition of v1 MVP Done

v1 MVP is accepted when all of the following are true:

1. Phases 0–9 are complete and every checkbox is checked.
2. Every decision blocker `BL-001`–`BL-013` is resolved.
3. A live ticket submitted from an Airiam app (BDT or another caller) flows through deployed-prod: persisted with `org_id` + `user_id`, dedup-checked, triaged with `type` + `severity` + deterministic `priority`, pushed to the ATD Linear team, confirmed by email to the submitter.
4. A curated Linear status transition on that ticket sends the customer-facing status email.
5. Coverage in CI is at or above 70% across lines, branches, functions, statements.
6. Architecture doc, this roadmap, and `AGENTS.md` are in sync with the shipped code. Any deviation has a note explaining why.

## 6. Change Policy

This roadmap is a living document. Updates follow the same precedence rules as the architecture doc:

- Changes to **phase ordering** or **decision blockers** require an explicit note in the next PR description and a corresponding update to the architecture doc's Open Questions section where relevant.
- Checking a box is **mandatory** in the PR that lands the corresponding work. Unchecked boxes for work that has shipped is a process bug.
- New blockers discovered mid-phase are added to the register with a status of `Open` and surfaced in the PR description, not silently absorbed.
- When a phase activates, create `docs/DC/P<N>-<phase-name>-plan.md` mirroring the structure of `design-team-rag/docs/DC/P1-0-Foundation-and-Contracts-Plan.md` (stages, commit checkpoints, verification commands, acceptance criteria).

---

*Last updated: 2026-05-12. Update in the same change set as any phase-completion, blocker-resolution, or scope-shift event.*
