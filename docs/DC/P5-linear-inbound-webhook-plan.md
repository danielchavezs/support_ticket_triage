# DC P5 — Linear Inbound Webhook Plan

| Field | Value |
| --- | --- |
| Owner | Daniel Chávez (ATD) |
| Phase | Phase 5 (Linear Inbound Webhook — receive Linear status changes, update tickets, emit `status_changed`) |
| Parent Plan | [`docs/DC/airiam-ticket-triage-roadmap.md`](./airiam-ticket-triage-roadmap.md) |
| Decision Baseline | No new `BL-*` blockers. Builds on `BL-008` (resolved). BL-011 (customer-facing status subset) is owned by Phase 6 and does not gate Phase 5 — the notifications hook ships as a no-op call here. |
| Architecture Baseline | [`docs/DC/airiam-ticket-triage-architecture.md`](./airiam-ticket-triage-architecture.md) — Pipeline §3 + "Linear Integration" subsection + "Signature verification on inbound webhook" subsection |
| Status | Drafted — execution in progress |
| Priority | P1 (gates Phase 6 status-change emails) |

## 1. Context

Phase 4 wires outbound: every triaged ticket reaches Linear and persists `linear_issue_id`. Phase 5 closes the loop: when ATD operators change an issue's state in Linear (Backlog → In Progress → Done, etc.), we receive the webhook, verify the signature, idempotently record the delivery, update the matching ticket row, and emit `ticket_events.status_changed`. The `notifications` Feature gets a no-op call wired up here so Phase 6 only needs to fill in the template/send logic.

Key invariants:

- Signature verification is **mandatory** and **first**: no payload-driven mutation happens before the signature passes.
- The endpoint is **always 200 for valid events** even when the ticket can't be found — Linear retries on non-2xx, and a 404-style response on an unknown ticket would create a retry storm.
- Duplicate deliveries are **swallowed silently only after successful processing**: at-least-once delivery is a webhook reality, exactly-once processing is our responsibility via an idempotency table. Failed or incomplete deliveries remain retryable.
- The Phase 6 notifications hook is a stub here. Phase 5 does NOT send any email.

## 2. Locked Decisions for This Plan

1. **Schema additions, not enum churn.** Add a free-form `tickets.linear_state text` column to capture whatever workflow state name Linear sends ("In Progress", "Done", a custom team state). Keep the existing `ticket_status` enum untouched. When Linear reports a terminal-state transition (state type = `completed` or `canceled`), we also flip our internal `status='closed'`; everything else only updates `linear_state`.
2. **Idempotency via a `webhook_deliveries` table.** Insert with a unique key of `(provider, delivery_hash)` where `delivery_hash` = SHA-256 of the raw body. New deliveries start as `processing`; only `processed` rows are terminal duplicates. Failed or incomplete rows are reused for retries so a transient ticket lookup/update failure does not permanently suppress Linear redelivery. Reusable seam for future webhook sources (email bounces, etc).
3. **Webhook event scope: Issue updates with state changes.** v1 only acts on `type='Issue'` + `action='update'` payloads where `updatedFrom.stateId` is present (meaning the state field actually changed). All other shapes are recorded for idempotency but otherwise ignored. Phase 6 can broaden the filter when it lands the email logic.
4. **No new `webhook.signature_failed` event type.** The architecture mentions the term descriptively, but routing signature failures through `ticket_events` requires a `ticket_id` we don't yet have (signature fails before payload parse). Structured logs cover the observability need; revisit if operators ever ask for queryable signature-fail history.
5. **The Linear Provider stays narrow.** We add a single new method (`parseWebhookPayload`) that wraps `LinearWebhookClient.parseData` — verifies and parses in one call. The Feature decides what to do with parse errors.
6. **No Provider-to-Feature regression.** The `webhook_deliveries` domain follows the same pattern as `dedup_signatures`: a thin Supabase adapter that throws raw errors and lets the Feature normalize. Org-scoping is **not** enforced here because some webhook events (signature fail, unknown ticket) can't be tied to an org.
7. **Single-PR delivery.** Mid-sized surface but no behavior gates between stages — author migrations + Provider + Feature + route together, run gates once.

## 3. Scope Split

### In Scope (Now)

- Migration 13: `tickets.linear_state` column (nullable text).
- Migration 14: `webhook_deliveries` table with `(provider, delivery_hash)` unique constraint.
- Provider additions:
  - `webhookDeliveries` domain: `recordOrSkip({ provider, deliveryHash, ticketId?, orgId?, eventType? })`.
  - `tickets.updateLinearState({ orgId, ticketId, linearState, status? })`.
  - `tickets.findByLinearIssueId(linearIssueId)` — read-only lookup, no org predicate (the webhook caller doesn't know which org yet).
  - `linear.parseWebhookPayload({ rawBody, signature, timestamp?, secret? })` — wraps the SDK's parse+verify; throws `LinearWebhookSignatureError` on signature fail.
- New Feature: `services/features/linear-sync/handleWebhook.ts` orchestrating the full flow.
- New route: `app/api/linear/webhook/route.ts` (POST only).
- Notifications stub: a `notifyStatusChange(ticketId, state)` no-op call site so Phase 6 has a known hook.
- `.env.local.example`: uncomment `LINEAR_WEBHOOK_SECRET` with provisioning notes.
- Tests:
  - `linearProvider.test.ts` extended: `parseWebhookPayload` happy path + signature failure.
  - `webhookDeliveriesDomain.test.ts`: unique-violation = duplicate; non-unique error propagates.
  - `ticketsFindByLinearIssueId.test.ts` and `ticketsUpdateLinearState.test.ts`: predicate/patch correctness.
  - `handleWebhook.test.ts`: signature pass, signature fail, unknown ticket, valid transition (state-only), terminal-state transition (state + status=closed), duplicate delivery, non-issue event ignored.
  - `linearWebhookRoute.test.ts`: 401 on signature fail, 200 on success/duplicate/unknown, 400 on bad JSON, 500 on unexpected feature failure.
- Roadmap: tick the Phase 5 box.

### Out of Scope (Later / Phase 6)

- The actual email send and the customer-facing transition subset (BL-011 + Phase 6).
- Webhook delivery cleanup / retention (the table will grow; v1 ships with no scheduled purge).
- Non-Issue Linear events (Comment, Reaction, Project, etc.).
- Per-org webhook secrets (v1 uses one shared `LINEAR_WEBHOOK_SECRET`).
- Replay protection beyond delivery hash (Linear's timestamp window is enforced by the SDK, and the route requires the timestamp header so freshness checks cannot be skipped).

## 4. Execution Stages

### Stage P5.1 — Plan + env + migrations

Goal: schema in place, env example refreshed, this plan on disk.

- [x] Tick the Phase 4 prerequisite box for Phase 5 in the roadmap.
- [x] Author this plan.
- [x] Migration `2026-05-18_13_add_linear_state_to_tickets.sql`:
  - `alter table tickets add column if not exists linear_state text;`
  - Comment explaining: free-form text from Linear, not constrained to our enum.
- [x] Migration `2026-05-18_14_create_webhook_deliveries_table.sql`:
  - `id uuid pk default gen_random_uuid()`, `provider text not null`, `delivery_hash text not null`, `received_at timestamptz not null default now()`, `processing_status text not null default 'processing'`, `processed_at timestamptz`, `last_error text`, `ticket_id uuid` (nullable), `org_id uuid` (nullable), `event_type text` (nullable).
  - `unique (provider, delivery_hash)` constraint.
  - Partial index on `(provider, received_at desc)` for operator queries.
  - No RLS (service-role only; not org-scoped).
- [x] Apply both migrations locally; regenerate `assets/databaseTypes.ts`. *(Types updated manually in this PR; user can re-run `pnpm gen-types` against the live Supabase project to confirm parity once the migrations land there.)*
- [x] Update `.env.local.example`: uncomment `LINEAR_WEBHOOK_SECRET` and add a sentence on where to configure it (Linear workspace → Settings → API → Webhooks).

Exit: migrations applied locally, types regenerated, env example up to date.

### Stage P5.2 — Provider additions

Goal: the read/write surfaces the Feature needs ship cleanly.

- [x] `services/providers/linear/index.ts`: add `parseWebhookPayload` that verifies the signature and JSON-parses the raw body; rewraps signature failures as `LinearWebhookSignatureError`.
- [x] `services/providers/supabase/domains/webhookDeliveries.ts`: new domain with `recordOrSkip(input): Promise<{ alreadyDelivered: boolean }>`, plus `markProcessed` and `markFailed`. Implementation: insert as `processing`; catch Postgres code `23505`, read the existing row, and return `{ alreadyDelivered: true }` only when it is already `processed`. Failed/incomplete rows remain retryable. All other errors propagate.
- [x] `services/providers/supabase/domains/tickets.ts`:
  - `findByLinearIssueId(linearIssueId)`: select * where `linear_issue_id = $1 and deleted_at is null` (no org predicate — caller doesn't know org until lookup resolves; `linear_issue_id` is globally unique via the partial-unique index).
  - `updateLinearState({ orgId, ticketId, linearState, status? })`: update both columns; `status` is optional so the Feature can flip to `'closed'` for terminal states.
- [x] `services/providers/supabase/server.ts`: wire the new domain into the `ServerSources` record.
- [x] Tests: `linearProvider.test.ts` extended; `webhookDeliveriesDomain.test.ts` new; `ticketsLinearState.test.ts` new (covers both `findByLinearIssueId` and `updateLinearState`).

Exit: each Provider method has a unit test asserting predicates / unique-violation behaviour.

### Stage P5.3 — handleWebhook Feature

Goal: end-to-end orchestration.

- [x] `services/features/linear-sync/handleWebhook.ts`:
  - Input: `{ rawBody: Buffer; signatureHeader: string | null; timestampHeader: string | null }`.
  - Steps:
    1. **Verify+parse** via `linear.parseWebhookPayload`. On `LinearWebhookSignatureError`, return `fail('LINEAR_WEBHOOK_SIGNATURE_INVALID', ...)`. On other parse errors, return `fail('LINEAR_WEBHOOK_PARSE_FAILED', ...)`.
    2. Compute `deliveryHash = sha256(rawBody)`.
    3. **Idempotency check**: `webhookDeliveries.recordOrSkip({ provider: 'linear', deliveryHash, eventType: payload.type })`. If `alreadyDelivered`, return `ok({ kind: 'duplicate' })`. If a previous attempt failed or never reached `processed`, continue processing the retry.
    4. Filter: only `payload.type === 'Issue' && payload.action === 'update' && payload.updatedFrom?.stateId` triggers state-transition handling. Anything else returns `ok({ kind: 'ignored', reason: '...' })`.
    5. **Lookup** the ticket by `payload.data.id` via `tickets.findByLinearIssueId`. If null, log a structured warning and return `ok({ kind: 'unknown_ticket', linearIssueId: payload.data.id })`.
    6. **Compute state transition**: new state = `payload.data.state.name`, type = `payload.data.state.type`. If type is `completed` or `canceled`, also flip ticket status to `'closed'`. Otherwise update `linear_state` only.
    7. **Persist** via `tickets.updateLinearState`.
    8. **Mark delivery processed** and backfill `(ticket_id, org_id)` for operator queryability. If processing fails before this point, mark the delivery `failed` so Linear retries can reprocess it.
    9. **Emit** `ticket_events.status_changed` with payload `{ previous_linear_state_id, new_linear_state_id, new_linear_state_name, new_linear_state_type, status_transitioned_to_closed }`.
    10. **Notifications stub**: call `notifyStatusChangeStub(ticket, transition)` — a no-op exported from `services/features/notifications/` (creates the directory + a placeholder module that Phase 6 fills in).
    11. Return `ok({ kind: 'applied', ticket, transition })`.
- [x] `services/features/notifications/index.ts` + `services/features/notifications/sendStatusChangeStub.ts`: minimal placeholder so Phase 6 has the seam wired.
- [x] Tests in `handleWebhook.test.ts` covering: signature fail, parse fail, duplicate, non-issue event, state-only update, terminal-state update (sets closed; both `completed` and `canceled`), unknown ticket. Each asserts the side-effects (Provider calls, event emit, notification call).

Exit: Feature compiles, all branches covered.

### Stage P5.4 — Route handler

Goal: HTTP transport thin and obvious.

- [x] `app/api/linear/webhook/route.ts` exporting a `POST` handler.
- [x] Pattern:
  1. Read `rawBody` via `await request.arrayBuffer()` → `Buffer.from(...)`. NextJS app router exposes the raw bytes this way; we do NOT `await request.json()` first because the SDK verifier needs the exact bytes.
  2. Read `linear-signature` and `linear-timestamp` headers. Both are required; missing either header is a signature failure.
  3. Call `handleWebhookFeature({ rawBody, signatureHeader, timestampHeader })`.
  4. Map FeatureError codes → HTTP:
     - `LINEAR_WEBHOOK_SIGNATURE_INVALID` → 401
     - `LINEAR_WEBHOOK_PARSE_FAILED` → 400
     - any other `success: false` → 500 (Linear retries)
  5. Map success outcomes → HTTP 200 with a small JSON body describing the kind (`applied`/`duplicate`/`ignored`/`unknown_ticket`).
- [x] Tests in `linearWebhookRoute.test.ts` covering each branch.

Exit: route compiles, tests pass.

### Stage P5.5 — Verification + roadmap

- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` all green.
- [x] `pnpm exec vitest run --coverage` ≥ 80% on every metric (92.52/84.85/93.75/93.83).
- [x] Tick the Phase 5 box in the roadmap Master Progress Checklist and the inline execution checklist.
- [x] Tick this plan's stage checkboxes.
- [ ] Manual smoke (deferred to user — needs Linear webhook configured to forward to a tunnel pointing at localhost; for example via `ngrok` or `cloudflared`):
  - Trigger an issue state change in Linear.
  - Confirm 200 response.
  - Confirm `tickets.linear_state` updated and `ticket_events.status_changed` emitted.
  - Trigger a duplicate delivery after a successful first delivery (resend from Linear); confirm second delivery is a fast 200 and no double event.
  - Force a transient processing failure before `markProcessed`, resend the same body, and confirm the retry is processed instead of swallowed as a duplicate.

## 5. Verification Commands

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm exec vitest run --coverage
pnpm build
```

Smoke (dev server up + tunnel):

```bash
# Generate signature locally for a hand-crafted payload (sanity check only).
node -e 'const c = require("crypto"); const body = process.argv[1]; console.log(c.createHmac("sha256", process.env.LINEAR_WEBHOOK_SECRET).update(body).digest("hex"))' '{"type":"Issue","action":"update","data":{"id":"lin-uuid","state":{"name":"Done","type":"completed"}},"updatedFrom":{"stateId":"old-state"}}'

# Then POST to the local route with the computed signature in linear-signature.
```

Inspect:

```sql
select * from webhook_deliveries order by received_at desc limit 5;
select event_type, payload from ticket_events where event_type = 'status_changed' order by created_at desc limit 5;
```

## 6. Acceptance Criteria (Phase 5 Done)

1. Every checkbox in Section 3 (In Scope) and Section 4 (P5.1–P5.5) is checked.
2. `app/api/linear/webhook/route.ts` exists; valid signed payloads return 200; invalid signatures return 401.
3. State-changed deliveries update `tickets.linear_state` and emit `status_changed`. Terminal-state transitions (`completed` / `canceled`) also flip `tickets.status='closed'`.
4. Duplicate deliveries are idempotent after successful processing: a second POST with the same body produces no additional event, while failed/incomplete attempts remain retryable.
5. Unknown `linear_issue_id` returns 200 (no retry storm) and is logged.
6. `notifyStatusChangeStub` is invoked on every applied transition; the Phase 6 seam exists.
7. `pnpm lint`, `pnpm typecheck`, `pnpm exec vitest run --coverage`, `pnpm build` all green; coverage ≥ 80% on every metric.
8. Phase 5 box checked in the roadmap.

## 7. Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| `rawBody` semantics differ between Next.js versions, breaking signature verification | High | Use `Buffer.from(await request.arrayBuffer())` directly; never call `request.json()` upstream. Unit test verifies the route forwards the bytes unchanged. |
| SHA-256 of raw body collides with a different valid payload | Negligible (cryptographic) | Accept the theoretical risk; the alternative is parsing first to extract a delivery ID, which defeats the "dedupe before any work" property. |
| Linear sends a payload with no `data.state` (non-state-change update) but we still mark idempotency | Low | Idempotency record is fine to keep — the filter step short-circuits anything that isn't a state change. |
| Linear retries with a slightly different timestamp header but the same body | Low | We hash the body, not the timestamp. Same body = same hash = same dedupe key. |
| `webhook_deliveries` table grows unbounded | Low (v1 volume) | Out of scope for v1; a scheduled `delete from webhook_deliveries where received_at < now() - '30 days'::interval` is a one-line follow-up when needed. |
| Notifications stub is silently broken when Phase 6 lands | Medium | The stub exports a real symbol with a real signature; if Phase 6 changes the contract, the existing call site catches it at typecheck. |

## 8. Closure (filled post-execution)

- **Verification evidence:** to be appended after PR lands.
- **Coverage summary:** to be appended.
- **Implementation notes:** to be appended.
- **Deferred follow-ups:** customer-facing subset filter (BL-011 + Phase 6), webhook_deliveries cleanup job, non-Issue event handling, per-org webhook secrets.

## 9. Change Policy

- Changes to **signature verification semantics** or **idempotency strategy** require a PR note + arch-doc update.
- New webhook event types handled require an explicit subsection in the architecture's "Linear Integration" block.
- Checking a box is **mandatory** in the PR that lands the corresponding work.
