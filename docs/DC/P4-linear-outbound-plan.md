# DC P4 — Linear Outbound (push) Plan

| Field | Value |
| --- | --- |
| Owner | Daniel Chávez (ATD) |
| Phase | Phase 4 (Linear Outbound — push every triaged ticket as a new Linear issue) |
| Parent Plan | [`docs/DC/airiam-ticket-triage-roadmap.md`](./airiam-ticket-triage-roadmap.md) |
| Decision Baseline | `BL-008` resolved (2026-05-16). Team ID locked in `AGENTS.md` §8; API key per environment via `LINEAR_API_KEY`. |
| Architecture Baseline | [`docs/DC/airiam-ticket-triage-architecture.md`](./airiam-ticket-triage-architecture.md) — Pipeline §3 step 6 + "Linear Integration" subsection + field-mapping table |
| Status | Drafted — execution in progress |
| Priority | P1 (gates Phase 5 webhook + Phase 6 emails) |

## 1. Context

Phases 1–3.5 ship a complete deterministic-plus-bounded-agentic triage path: receive → dedup → tool-augmented LLM classification → matrix-priority → persist → emit `triaged`. The ticket lands in our DB but does not yet reach Linear, so Linear-side workflow (Triage queue, assignments, status changes) cannot start.

Phase 4 wires the outbound push: after a successful triage, the pipeline creates a new Linear issue in the ATD team's Triage queue, persists `linear_issue_id` on the ticket row, and emits `ticket_events.pushed_to_linear`. On Linear failure the ticket stays `triaged` and a `failed` event with `stage='linear_push'` is emitted; the existing retry dispatcher resumes from "triaged with no linear_issue_id."

Intended outcomes:

1. Every successfully-triaged ticket reaches Linear in the same submission turn.
2. `linear_issue_id` is persisted exactly once per ticket; the column's partial-unique index in `migrations/2026-05-13_05_create_tickets_table.sql:108` enforces idempotency at the DB layer.
3. Linear failures do not roll back triage state. The retry endpoint resumes the push.
4. The Linear Provider exposes the surface Phase 5 will need (webhook signature verify) so Phase 5 lands without restructuring.

## 2. Locked Decisions for This Plan

1. **No DB migrations.** Schema is already prepped: `tickets.linear_issue_id` exists, `pushed_to_linear` is a valid `ticket_event_type` enum value, and the partial-unique index on `linear_issue_id` (where not null) prevents double-creation. Phase 4 is purely Provider + Feature + pipeline wiring.
2. **Linear team ID via env, not hardcoded.** `LINEAR_TEAM_ID` is required. The default (the ATD team in `airiamspace`) is documented in `AGENTS.md` §8, but the constant lives in env so dev/prod can target different teams.
3. **`@linear/sdk` v84.** Modern surface: `LinearClient.createIssue(input)` for outbound; `LinearWebhookClient.verify(rawBody, signature, timestamp)` for Phase 5 webhook signature verification.
4. **Priority mapping is total.** P1→Urgent (1), P2→High (2), P3→Medium (3), P4→Low (4). No "no priority" (0) — the matrix is total over our type×severity, so every triaged ticket has a priority.
5. **No Linear labels in v1.** The architecture's field-mapping table maps `type → Linear label`, but Linear's label API requires label IDs (not names) and label seeding is per-environment manual setup. v1 puts type / severity / confidence / dedup status / org_id / user_id / source_kind in the issue body footer; labels are deferred to a post-MVP follow-up (`BL-008.1` if scoped later).
6. **Idempotency via the partial-unique index.** If the Linear push runs twice for the same ticket, the second attempt's DB write fails on the unique constraint — better than silently double-creating in Linear. The Feature catches the unique-violation and treats it as a no-op success.
7. **Transient failure ⇒ `triaged` state preserved.** On Linear createIssue failure, we do NOT mutate the ticket row. `status` stays `'triaged'` with `linear_issue_id IS NULL`; an `events.failed` row with `stage='linear_push'` is emitted; the retry dispatcher detects the gap and re-tries the push. This contrasts with triage failures which reset `status='failed'` — Linear is a downstream sink, not a state invariant.
8. **Single-PR delivery.** Smaller surface than Phase 3.5 — one Provider, one Feature, one pipeline wire-up, one retry branch, no schema work. Per-stage commits as we go; one PR at the end.

## 3. Scope Split

### In Scope (Now)

- Add `@linear/sdk` dependency.
- New Linear Provider at `services/providers/linear/`:
  - `client.ts` — `getLinearClient()` factory (lazy env read, mirrors `getTriageModel()`).
  - `index.ts` — `LinearProvider` interface + implementation: `createIssue`, `getIssue`, `verifyWebhookSignature`.
- New linear-sync Feature at `services/features/linear-sync/pushTicket.ts`:
  - Field-mapping helper `buildIssueInput(ticket): IssueCreateInputBody`.
  - `pushTicketToLinearFeature(input)` orchestrator that catches Provider errors and normalizes to `FeatureError`.
- New Provider-domain method `tickets.updateLinearLink({ orgId, ticketId, linearIssueId })`.
- Wire `pushTicketToLinearFeature` into `createTicketFeature` after a successful `triageTicketFeature`.
- Extend `retryTicketTriageFeature` with a new branch: `status='triaged' AND linear_issue_id IS NULL → re-run linear push`.
- Update `.env.local.example`: uncomment `LINEAR_API_KEY`, `LINEAR_TEAM_ID`; document where to provision them.
- Tests:
  - `tests/unit/linearProvider.test.ts` — mocked SDK, asserts createIssue input shape + error propagation + webhook signature pass/fail.
  - `tests/unit/pushTicket.test.ts` — happy path, transient failure path, idempotency on linear_issue_id unique-violation, field-mapping correctness.
  - Extend `tests/unit/ticketsFeatures.test.ts` — pipeline now invokes Linear push after triage; failure does not affect ticket creation; event emissions ordered correctly.
  - Extend `tests/unit/retryTicketTriage.test.ts` — new branch for "triaged but no linear_issue_id."
- Roadmap: tick Phase 4 box in Master Progress Checklist.

### Out of Scope (Later)

- Linear labels (deferred; type/severity etc. go into body footer).
- Project / cycle / assignee mapping (none in v1).
- Inbound webhook handler and signature-failed events (Phase 5).
- Email notifications on push success (Phase 6).
- Background retry worker — v1 retry is manual via the existing endpoint.
- Multi-team routing (the architecture locks one team in v1).

## 4. Execution Stages

### Stage P4.1 — Plan + register + deps

Goal: register update, plan doc landed, dep installed, env example refreshed.

- [x] Resolve `BL-008` in the register with a one-line note.
- [x] Check the Phase 4 prerequisite box for `BL-008`.
- [x] Author this plan (`docs/DC/P4-linear-outbound-plan.md`).
- [x] `pnpm add @linear/sdk` (v84.0.0).
- [x] Update `.env.local.example` — uncomment `LINEAR_API_KEY`, `LINEAR_TEAM_ID`; add comments pointing to AGENTS.md §8 for the team-ID source of truth.

Exit criteria: `BL-008` reads Resolved; this plan is on disk; `@linear/sdk` resolves at install; env example reflects the now-required keys.

### Stage P4.2 — Linear Provider

Goal: a narrow Provider that wraps the SDK without leaking SDK types into Features.

- [x] `services/providers/linear/client.ts` — `getLinearClient()` and `getLinearWebhookClient(secret)` factories. Read env at call time, throw with clear messages on missing key.
- [x] `services/providers/linear/index.ts` — `LinearProvider` type + `linear` singleton implementing:
  - `createIssue(input: { teamId, title, description, priority }): Promise<{ issueId, identifier, url }>`. Throws on SDK rejection. Resolves the lazy `issue` accessor to surface `identifier` and `url` (one extra round-trip, cheap, gives operators useful audit metadata).
  - `getIssue(issueId): Promise<{ id, identifier, url, state, title } | null>`. Used by Phase 5 webhook to look up the ticket-side mapping; null on not-found.
  - `verifyWebhookSignature({ rawBody, signature, timestamp?, secret }): boolean`. Wraps `LinearWebhookClient.verify`. Throws on bad signature per SDK contract.
- [x] `tests/unit/linearProvider.test.ts` — mock `@linear/sdk` and `@linear/sdk/webhooks`; assert createIssue forwards the input, returns the unwrapped `{ issueId, identifier, url }`, propagates SDK errors raw, and verifyWebhookSignature returns the wrapped boolean.

Exit criteria: Provider exists; tests pass; no Feature-layer imports inside the Provider; no SDK imports anywhere else.

### Stage P4.3 — pushTicket Feature

Goal: Feature-layer push with field mapping and Provider-error normalization.

- [x] `services/features/linear-sync/pushTicket.ts`:
  - `buildIssueInput(ticket): { teamId, title, description, priority }` — pure helper. Maps:
    - `ticket.subject` → `title`.
    - Body: `customer_facing_summary` + a horizontal rule + `description` + a footer block with `type`, `severity`, `confidence`, `needs_human_triage`, `dedup_signature` (8-char preview), `org_id`, `user_id`, `source_kind`, `ticket_id`. Markdown.
    - `ticket.priority` → Linear priority via `priorityToLinear({ P1: 1, P2: 2, P3: 3, P4: 4 })`. Throws on a triaged ticket with no priority (shouldn't happen — defense in depth).
  - `pushTicketToLinearFeature(input: { orgId, ticketId })` orchestrator:
    1. Fetch ticket (org-scoped). Return `TICKET_NOT_FOUND` / `TICKET_FETCH_FAILED` on the obvious paths.
    2. If `linear_issue_id` already set, no-op (idempotent).
    3. If ticket is not in a pushable state (`status !== 'triaged'` — duplicate / failed / received tickets do not push), return ok(ticket) without doing anything.
    4. Build the input via `buildIssueInput`. On failure, return `VALIDATION_ERROR`.
    5. Call `linear.createIssue(input)`. On SDK rejection, emit `failed` event with `stage='linear_push'`, return `LINEAR_PUSH_FAILED` (ticket row untouched).
    6. On success, write `linear_issue_id` via `tickets.updateLinearLink`. On unique-violation (DB-level idempotency), refetch and treat as success. On any other DB error, emit `failed` with `stage='linear_push'` and return `LINEAR_PERSIST_FAILED`.
    7. Emit `ticket_events.pushed_to_linear` with `{ linear_issue_id, linear_identifier, linear_url }` in the payload.
- [x] `tests/unit/pushTicket.test.ts` — Provider-mocked tests for: field mapping, success path, transient-failure does-not-mutate-ticket, unique-violation idempotency, no-op when already pushed, no-op when status ≠ triaged.

Exit criteria: Feature exists; tests pass; no SDK imports.

### Stage P4.4 — Pipeline wiring + retry dispatcher branch

Goal: Linear push runs inline after successful triage; the retry endpoint resumes a stuck push.

- [x] Add `tickets.updateLinearLink({ orgId, ticketId, linearIssueId })` to `services/providers/supabase/domains/tickets.ts`.
- [x] Modify `createTicketFeature` (`services/features/tickets/ticketsFeatures.ts:52`): after the existing triage call, if `triage.success` and `triage.data.status === 'triaged'`, invoke `pushTicketToLinearFeature({ orgId, ticketId })`. Errors are logged but do not affect the return value to the caller — ticket creation + triage succeeded, Linear lag is recoverable.
- [x] Extend `retryTicketTriageFeature` (`services/features/tickets/ticketsFeatures.ts:176`) with a new branch after the existing triage branch: `status='triaged' && linear_issue_id == null → re-run linear push`.
- [x] Update `tests/unit/ticketsFeatures.test.ts` for the new behaviour. `tests/unit/retryTicketTriage.test.ts` mocks the Feature so requires no change.

Exit criteria: full local gates pass; coverage stays at or above 80% across every metric; the retry dispatcher's table is documented inline.

### Stage P4.5 — Verification + roadmap

Goal: green local gates plus a documented manual smoke gate against a live Linear API key.

- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` all green.
- [x] `pnpm exec vitest run --coverage` — at or above 80% on every metric (91.89/84.13/93.02/93.27).
- [x] Tick the Phase 4 box in [`docs/DC/airiam-ticket-triage-roadmap.md`](./airiam-ticket-triage-roadmap.md) Master Progress Checklist.
- [ ] Manual smoke (deferred to user — needs a real `LINEAR_API_KEY`):
  - Submit a ticket through `localhost:3000`.
  - Confirm the new issue appears in the ATD Triage queue with title=subject, body=description+footer, priority=mapped from matrix.
  - Confirm `linear_issue_id` is persisted on the ticket row.
  - Confirm `ticket_events.pushed_to_linear` payload includes `linear_identifier` and `linear_url`.
  - Force a transient failure (revoke the key briefly, submit, restore) and verify the retry endpoint re-pushes successfully without duplicating in Linear.

Exit criteria: all local gates pass; Phase 4 acceptance criteria (Section 6) all satisfied modulo the deferred-to-user smoke gate.

## 5. Verification Commands

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm exec vitest run --coverage
pnpm build
```

Smoke (dev server up):

```bash
curl -s -X POST http://localhost:3000/api/tickets \
  -H 'content-type: application/json' \
  -d '{"orgId":"<dev-org>","userId":"<dev-user>","subject":"Phase 4 smoke","description":"Test Linear push."}' \
  | jq '{id, status, type, severity, priority, linearIssueId}'
```

Then inspect Linear directly or via:

```sql
select event_type, payload from ticket_events
where ticket_id = '<id>'
order by created_at asc;
```

Look for `pushed_to_linear` with `payload.linear_issue_id`, `payload.linear_identifier`, `payload.linear_url`.

## 6. Acceptance Criteria (Phase 4 Done)

1. Every checkbox in Section 3 (In Scope) and Section 4 (P4.1–P4.5) is checked.
2. `services/providers/linear/` exposes `createIssue`, `getIssue`, `verifyWebhookSignature`. No imports from `services/features/`.
3. `createTicketFeature` invokes Linear push inline after triage succeeds; Linear failure does not roll back ticket creation or triage state.
4. `tickets.linear_issue_id` is persisted exactly once per ticket; partial-unique index prevents double-creation.
5. Retry dispatcher resumes "triaged with no linear_issue_id" tickets.
6. `pnpm lint`, `pnpm typecheck`, `pnpm exec vitest run --coverage`, `pnpm build` all green; coverage at or above 80% on every metric.
7. Phase 4 box checked in [`docs/DC/airiam-ticket-triage-roadmap.md`](./airiam-ticket-triage-roadmap.md).
8. Manual smoke confirms outbound push end-to-end (deferred to user — requires live Linear API key).

## 7. Closure (filled post-execution)

- **Verification evidence:** to be appended after PR lands.
- **Coverage summary:** to be appended.
- **Implementation notes:** to be appended.
- **Deferred follow-ups:** Linear labels (`BL-008.1` if scoped), label-ID per-env config, multi-team routing, background-retry worker.

## 8. Change Policy

- Changes to **field mapping** or **transient-failure semantics** require an explicit note in the PR description and a corresponding update to the architecture doc's "Linear Integration" subsection.
- Checking a box is **mandatory** in the PR that lands the corresponding work.
- New write paths to Linear (assignments, comments) are **out of scope** for Phase 4 and require a follow-up plan, not a silent expansion.
