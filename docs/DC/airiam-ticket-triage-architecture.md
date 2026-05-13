# Airiam Ticket Triage: Project Architecture

*Draft v0.1, 2026-05-12*
*Owner: Daniel Chávez (Airiam Advanced Tech Division)*

## Purpose

This document is the single source of truth for the technical scope, architecture, and locked decisions of the `airiam-ticket-triage` project. It supersedes the v1.0 and v1.1 design notes under `docs/requirements/legacy/`, which were authored for a larger Customer Intake Portal vision and are retained for historical context only.

Precedence on conflict:

1. Actual code and runnable configuration in this repo.
2. This document.
3. Other non-legacy docs under `docs/`.
4. `AGENTS.md`.
5. Anything under `docs/requirements/legacy/`.

## What This Is

An internal-facing ticket triage system, owned by the Advanced Tech Division (ATD), that receives ticket submissions from two source types, classifies and prioritizes each one with an LLM-assisted pipeline, deduplicates against existing tickets, pushes the resulting ticket into the ATD Linear workspace, and notifies the original submitter via email.

The system is a single Next.js 16 application that serves both the REST API and any internal UI. Backend is server-side TypeScript via Next.js Route Handlers. Persistence is a dedicated Supabase Postgres project that is not shared with the Airiam Intelligence Platform (AIP).

## What This Is Not (Non-Goals for v1)

- Not a customer-facing branded portal. There is no public sign-up, no external login, no `intake.example.com` surface in v1.
- Not multi-tenant in the AIP sense. We carry `org_id` and `user_id` per request, but a single shared deployment serves all callers and there is no per-tenant data plane.
- Not the v1.1 Customer Intake Portal described in `docs/requirements/legacy/`. That spec was designed for two cloud tenants (Airiam + Canopy), Entra External ID customer accounts, FastAPI services in the AIP monorepo, Web PubSub fanout, and SOC2-grade audit chains. None of that is in scope for this project's v1.
- Not coupled to AIP at runtime. AIP is months away from production and this project is expected to ship first.

## Relationship to AIP

Standalone in v1. The project mirrors AIP's layered architecture (Providers / Features / API) and its naming conventions so that a future merge or AIP-side adoption is a refactor of scale, not of shape. Concrete coupling points (consuming AIP's customer registry, emitting events into the AIP bus, calling AIP's LLM intercept) are deferred and explicitly out of scope until both systems are in production.

## Architecture Principles

1. **One Next.js app.** Single deployable. UI, API, and scheduled work all live under `app/`. No separate FastAPI service, no worker tier in v1.
2. **Provider abstraction at the boundary.** Every external dependency (Supabase, LLM, Linear, email) sits behind a Provider with a Protocol-style TypeScript interface. Features call Providers, never the underlying SDK directly.
3. **Features own business behavior.** Triage, dedup, Linear push, and email orchestration are Features. The API layer is thin transport.
4. **Deterministic where possible.** Priority is computed by table lookup from `severity` and `type`, not by LLM judgment. The LLM produces classifications; deterministic code makes consequential decisions.
5. **Org-scoped authorization.** Every request is tied to `org_id` and `user_id`. User-JWT paths rely on Supabase RLS; service-role paths must explicitly scope reads and writes by the trusted request context because service-role access bypasses RLS.
6. **Designed for extension.** Each capability that could later expand (additional intake sources, dedup strategies, model providers, email triggers) is built behind a Provider or strategy seam, so extension is additive, not architectural.

## Service Topology

```
                       Caller 1: in-app submissions
                       (Airiam app server-to-server,
                       asserts org_id + user_id)
                                |
                       Caller 2: AIP monitoring
                       (deferred contract)
                                |
                                v
                       +-------------------------+
                       |  Next.js API            |
                       |  app/api/tickets        |
                       +-----------+-------------+
                                   |
                                   v
                       +-------------------------+
                       |  services/features/     |
                       |  - tickets              |
                       |  - triage               |
                       |  - dedup                |
                       |  - linear-sync          |
                       |  - notifications        |
                       +-----------+-------------+
                                   |
                                   v
                       +-------------------------+
                       |  services/providers/    |
                       |  - supabase             |
                       |  - llm (Gemini today)   |
                       |  - linear               |
                       |  - email (TBD)          |
                       |  - monitoring (deferred)|
                       +-------------------------+

           Supabase Postgres (dedicated project per environment)
           Linear (ATD workspace, single team)
           Email provider (TBD)
```

## Layer Pattern

Three layers. Strict one-way dependency direction.

```
+-------------+
|     APP     |  app/ : route handlers, pages, layouts, React components.
+-------------+
       |
       v
+-------------+
|  FEATURES   |  services/features/ : business orchestration, validation,
+-------------+  error normalization, multi-Provider coordination.
       |
       v
+-------------+
|  PROVIDERS  |  services/providers/ : SDK adapters, one per external
+-------------+  dependency. No business logic, no cross-Provider calls.
```

### Rules

- **App** never imports Providers. It imports Features only.
- **Features** never import from `app/`. They are framework-agnostic.
- **Providers** never import Features, App, or other Providers. Each Provider is a self-contained adapter for exactly one external dependency.
- **Cross-Provider composition** happens at the Feature layer, never inside a Provider.
- **Features may call other Features** when the coupling is domain-local. When it would create a cycle, the responsibility belongs in a higher-level orchestrator Feature or on a queue / event boundary.

## Current Implementation Gap Snapshot

Last reviewed on 2026-05-13. These are implementation gaps against this document, not alternate scope.

Closed by Phase 0 (AIR-190):

- ~~`package.json` legacy name and missing `typecheck` script.~~ Resolved: name is `airiam-ticket-triage`; `typecheck` script added.
- ~~Existing integration adapters under `services/sources/`.~~ Resolved: renamed to `services/providers/`.
- ~~No `.env.local.example`.~~ Resolved: template exists at the repo root and lists every key in `AGENTS.md` §10.

Open (gated by later phases):

- **No DB schema exists yet.** The forked-project migration from 2026-02-05 has been deleted; it described a single-table shape that was never applied for this project and is no longer relevant. Phase 1 lands the v1 schema fresh: `orgs`, `users`, `tickets` (with `org_id`, `user_id`, new enums, derived `priority`, embedding column), `ticket_events`, `dedup_signatures`, plus RLS on every org-scoped table.
- The current Provider/Feature/route code still references legacy triage shapes (`priority: 'Critical' | 'High' | …`, `category: 'Billing' | …`). Phase 1 rewrites the Provider domain types and Zod schemas to the v1 model; Phase 2 wires the deterministic priority matrix.

## Data Layer

### Database target

Supabase Postgres, dedicated project for this app. Not shared with AIP. Connection patterns:

- **User-context paths (future):** the Supabase JS SDK bound to a user JWT. RLS policies do the filtering.
- **Service paths (today):** Supabase service-role client is constructed server-side and used behind the Supabase Provider. Feature entry points pass trusted `org_id` and `user_id` context, and Provider / repository methods enforce explicit scoping in every query. Service-role access is constrained to specific Features, not used as the blanket default.

### Schema (v1 starter, draft)

Authoritative schema lives in `migrations/`. v1 starter tables:

| Table | Purpose |
|---|---|
| `orgs` | Authorized calling organizations. Holds the org identifier the calling app asserts plus metadata (name, status). |
| `users` | Authorized users, scoped by `org_id`. Holds the user identifier each calling app asserts plus metadata (email, display name). **No role column in v1** (`BL-003` resolved 2026-05-13). Roles remain a planned post-v1 addition; the seam is preserved in the Roadmap and Modularity Seams table below. |
| `tickets` | One row per submitted ticket. Carries `org_id`, `user_id`, source kind, raw submission, LLM-classified `type` and `severity`, computed `priority`, status, dedup linkage, Linear issue reference, embeddings. |
| `ticket_events` | Append-only event log per ticket, carrying `org_id` for simple RLS and event-list queries. Lightweight audit trail. v1 captures: `received`, `triaged`, `deduplicated`, `pushed_to_linear`, `status_changed`, `email_sent`, `failed`. |
| `dedup_signatures` | Deterministic-hash index for dedup. One row per `(org_id, normalized_signature)` with a reference back to the canonical ticket. |

Embeddings for vector dedup live as a `pgvector` column on `tickets` (`description_embedding`), populated by a Feature, queried by the dedup Feature. Phase 1 creates this as an unconstrained `vector`; Phase 3 locks dimension-specific indexing after the embedding model decision resolves.

### RLS posture in v1

RLS policies are written and enabled on every org-scoped table from day one. They are designed for the future when end-user JWTs flow through. In v1 the API runs server-to-server and uses the service-role client, so RLS is mostly defense-in-depth and is exercised only on internal admin tooling or future user-facing surfaces. Because service-role access bypasses RLS, Provider / repository methods must require org/user context and include scoping predicates. The schema and policies are correct from day one; what changes later is which client we bind.

Policy pattern (illustrative, refined per table):

```sql
-- Org-scoped read policy on tickets:
create policy tickets_select_by_org on tickets
  for select
  using ((auth.jwt() ->> 'org_id')::uuid = org_id);
```

### Soft deletes

`deleted_at timestamptz null` on org-scoped tables. Default queries filter for `deleted_at is null` inside the Provider repository wrappers, not via per-query filters sprinkled across Features.

### Migrations

SQL files under `migrations/`, applied via the Supabase CLI. One migration per logical change. Naming: `YYYY-MM-DD_<short_description>.sql`. No ORM in v1; SQL is the contract.

## Intake Sources

### Source A: in-app user submissions (server-to-server)

Calling pattern: each Airiam-built app (BDT, AIP, future apps) calls our REST API from its own backend after a user has clicked "open a ticket" or equivalent. The calling app:

- Asserts the end user's identity (`org_id`, `user_id`, `email`) in the request body or signed envelope. The receiver validates that assertion against the caller credential and allowed org/source configuration.
- Provides the user's free-text input plus any pre-collected structured fields (component, page, error code, etc.).
- Authenticates the call itself with a service credential. **Specific mechanism is deferred** (see Open Questions). Working assumption: HMAC-signed request with a per-app shared secret, with a 5-minute timestamp window.

### Source B: AIP monitoring webhook (deferred contract)

AIP will eventually emit incident-shaped events to our API. The contract is undefined. Our adapter Feature scaffolds a normalization path so the addition is later additive: a new Provider plus a new Feature module under `services/features/intake/aip-monitoring/`.

### Normalization

Every incoming submission, regardless of source, is normalized into a single internal `TicketSubmission` shape before reaching the triage Feature. Source-specific defaults (severity prior, type prior, dedup window) live in a small `SourceProfile` map keyed by `source_kind`.

## Triage Pipeline

### Steps

1. **Receive and persist.** Insert the raw submission into `tickets` with `status = 'received'`. Emit `ticket.received` event.
2. **Dedup check.** Compute the deterministic signature; query `dedup_signatures` for the calling `org_id`. If hit: mark as `duplicate_of`, set status accordingly. Action on hit (reject, link, merge) is **deferred**.
3. **LLM classification.** Call the LLM Provider to produce `{ type, severity, customer_facing_summary, suggested_reply, confidence }`. Validated with Zod.
4. **Deterministic priority.** Compute `priority = priorityMatrix[severity][type]`.
5. **Persist triage result.** Update the ticket row, emit `ticket.triaged`.
6. **Push to Linear.** Create a Linear issue via the Linear Provider. Store `linear_issue_id` on the ticket. Emit `ticket.pushed_to_linear`.
7. **Send confirmation email.** Via the email Provider (deferred). Emit `ticket.email_sent`.

Steps 3 through 7 run inline in v1 (no separate worker tier). The create-ticket endpoint returns after inline processing completes, with the current ticket state. If any step fails, the ticket is left in a recoverable state with status reflecting the failure point, and a manual retry endpoint is exposed (the existing `retryTicketTriage` flow generalized). If this later moves to background execution, the API contract should switch deliberately to 202 Accepted.

### Priority matrix

Locked 2026-05-13 (`BL-001`). `type` and `severity` are produced by the LLM. `priority` is computed by lookup.

| severity \ type | bug | feature | improvement | question | incident |
|---|---|---|---|---|---|
| **blocker** | P1 | P2 | P2 | P2 | P1 |
| **major** | P2 | P2 | P3 | P3 | P2 |
| **minor** | P3 | P3 | P3 | P4 | P3 |
| **trivial** | P4 | P4 | P4 | P4 | P4 |

Notes:

- `P1` = Critical, `P2` = High, `P3` = Medium, `P4` = Low.
- Cells like `blocker x feature` are rare but the matrix is total to avoid `null` outputs.
- This table lands in code as `services/features/triage/priorityMatrix.ts` in Phase 2.

### Enums

Locked 2026-05-13 (`BL-002`).

- `type`: `bug | feature | improvement | question | incident`
- `severity`: `blocker | major | minor | trivial`

Both are encoded as Postgres `CREATE TYPE` enums in Phase 1. Adding a value later is a single `ALTER TYPE`; renaming or removing one requires a more careful migration, so any future change to either enum is a deliberate decision.

### LLM provider in v1

Stays on Google Gemini via the Vercel AI SDK, matching the current code. Vertex AI / Azure OpenAI swaps are a Provider-level change, not architectural. Two-stage classification (Gemini Flash filter + GPT-4o triage) from the legacy design is **not in v1**; one Provider call, revisited only if accuracy on a future eval set is insufficient.

### Confidence handling

The LLM Provider returns a confidence indicator alongside the classification. Below-threshold results land in Linear with a label such as `needs-human-triage` and are flagged in the email confirmation. Threshold value is calibrated against the eval set once we have one.

## Deduplication Design

Two strategies, both implemented behind a `DedupStrategy` interface in `services/features/dedup/`:

1. **Deterministic hash.** Normalize subject + description (lowercase, trim, collapse whitespace, strip punctuation), hash, scoped to `org_id`. Insert into `dedup_signatures` on every new ticket. Lookup on the next submission.
2. **Vector similarity (pgvector).** On insert, write `description_embedding` to the row. On query, perform a cosine-similarity search scoped to `org_id`. Configurable similarity threshold.

Both strategies are in v1 scope. The deterministic strategy gates first; the vector strategy is a soft flag that surfaces likely-near-duplicates on the resulting ticket for the assignee to merge in Linear.

**Open:** action on hit (reject, link, merge), dedup window (forever, 30 days, 90 days, per-org configurable), and whether the vector check is on by default or behind a feature flag. All deferred.

## Email and Notification

### Triggers

- **Submission confirmation.** Sent to the submitter as soon as the ticket is persisted and triaged, with the ticket reference and the LLM-drafted reply.
- **Selected status updates.** When the Linear webhook reports a status transition that we curate as customer-relevant (subset of all Linear transitions). The specific transitions in the customer-facing subset are **deferred**.

### Provider

Email provider is **deferred**. The Provider interface lives in `services/providers/email/` with a Protocol-style TypeScript signature; concrete implementations (Resend, Postmark, Azure Communication Services, etc.) plug in when the choice is locked.

### Sending domain

Deferred.

## Linear Integration

### Direction

- **v1 outbound:** every triaged ticket is pushed as a new issue into the ATD team's Triage queue in the team-scoped Linear workspace. The Linear issue ID is persisted on the ticket row.
- **v1 inbound (curated):** a webhook listener under `app/api/linear/webhook` receives status-change events from Linear, filters to a curated subset of transitions, updates the ticket row, emits `ticket.status_changed`, and triggers a status email if the transition is in the customer-facing subset.

### Workspace specifics

- Workspace: Airiam Advanced Tech Division Linear workspace, team-scoped. Already provisioned.
- Single team destination in v1. No category-to-team routing.
- API key obtained per environment, stored in environment-scoped secrets.

### Field mapping

| Internal field | Linear field |
|---|---|
| `subject` | issue title |
| `description` + suggested reply + LLM rationale | issue body |
| `priority` (P1..P4) | Linear priority (Urgent / High / Medium / Low) |
| `type` | Linear label |
| `org_id`, `user_id`, `source_kind`, `ticket_id` | issue body footer plus labels |

### Signature verification on inbound webhook

The route handler captures the raw body and signature headers, then calls a Linear webhook Feature. That Feature invokes the Linear Provider's signature verification helper before mutating ticket state. Failed verification returns a normalized Feature error that the API maps to 401 and records as `webhook.signature_failed`.

## Observability and Monitoring

In v1: standard Next.js and Node logging plus structured logs from Features and Providers. No vendor monitoring backend locked. The `services/providers/monitoring/` directory is reserved for a future Provider (Logfire, Sentry, App Insights, or AIP-side ingestion). Build proceeds without it.

Structured log fields on every API request: `request_id`, `org_id`, `user_id`, `source_kind`, `ticket_id` (when known), `duration_ms`, `outcome`. Used today only for stdout; ready for shipping into a backend later without code changes in Features.

PII redaction: any field that could carry PII (email addresses, raw user descriptions) is redacted by default in structured logs. Expandable only in dev environments via an explicit toggle.

## CI/CD

### Provider

GitHub Actions.

### Pipeline (planned)

- **On PR:** `pnpm lint`, `pnpm typecheck` (`tsc --noEmit`), `pnpm test`, `pnpm build`.
- **On merge to `main`:** trigger deploy to the **deployed dev** environment.
- **On tagged release (or manual `workflow_dispatch` from `main`):** deploy to **deployed prod**.

### Branching

Pattern: `feature/* -> dev -> main`. No direct pushes to `dev` or `main`. PRs require human approval; no agent may approve. Every commit and PR references a Linear ticket where one exists.

### Environments

- **local dev** (developer machine, `.env.local`, runs against a developer-personal Supabase project or a shared dev project).
- **deployed dev** (Azure, its own Supabase project, its own Linear workspace API key).
- **deployed prod** (Azure, its own Supabase project, its own Linear workspace API key).

Production Supabase data never enters dev. Dev contexts cannot read production secrets. Enforced by separate Supabase projects and separate Azure resource group identities.

## Security and Secrets

- Secrets via environment variables. Local: `.env.local`. Deployed: Azure environment-scoped secrets (exact service deferred along with hosting choice).
- Never commit secrets. Pre-commit and CI secret-scanning to be added.
- Supabase service-role key is server-only and used only in specific Features (write paths during v1, admin paths). Never exposed to the browser.
- RLS is enabled on every org-scoped table from migration day one. Service-role bypass is intentional but tracked and paired with explicit org/user scoping in Provider queries.
- LLM responses are validated with Zod before being trusted. Treat all LLM output as untrusted input.
- Log redaction for any field that could be PII (email addresses, raw user descriptions): redacted by default in structured logs, expandable only in dev environments.

## Hosting (Draft, not fully locked)

Planned target: **Azure Container Apps**, scale-to-zero, containerized Next.js standalone build. Idiomatic for a serverless-style Next.js deployment on Azure: full Next.js runtime support (including API routes, middleware, server components), single deployable, integrated with Azure-native networking and identity.

This is a working assumption documented for planning purposes. Final DevOps decision may shift to another Azure service (App Service, Static Web Apps + Functions, custom setup). Treat as not yet locked.

## Roadmap and Modularity Seams

Hooks where the larger v1.1 design or AIP-side coupling could later slot in without architectural rework:

| Future addition | Where it plugs in |
|---|---|
| Customer-facing portal | New routes under `app/(public)/`, new auth Provider, new RLS path bound to user JWT |
| Two-stage AI classification | LLM Provider grows a strategy pattern; Feature is unchanged |
| Presidio PII scrubbing | New Provider `services/providers/pii/`, called from triage Feature before LLM step |
| AIP monitoring ingestion | New Feature `services/features/intake/aip-monitoring/`, new normalizer in `SourceProfile` map |
| AIP customer registry enrichment | New Provider that reads from AIP DB; called from triage Feature |
| Web PubSub real-time | New Provider, new client wrapping; Features publish updates through it |
| Embedded widget | Separate package; consumes the same API |
| Eval pipeline | `tests/evaluation/` directory pattern from design-team-rag; offline runner |
| Vendor monitoring backend | Fill in `services/providers/monitoring/` |
| Role-based access | Extend `users` schema, add a `roles` table, plug into RLS predicates |

## Open Questions and Decision Register

Items deferred during the scoping pass on 2026-05-12. Each is a small, scoped decision that does not block v1 work as a whole.

1. **Service-to-server caller auth mechanism for in-app submissions** (HMAC, OAuth client credentials, signed JWT, etc.).
2. ~~**Role model on `users`**~~ — **Resolved 2026-05-13:** no role column in v1; additive future migration if/when needed.
3. **AIP monitoring webhook contract** (payload shape, auth, retry semantics).
4. **Dedup action on hit** (reject, link, merge).
5. **Dedup window** (forever, 30d, 90d, per-org configurable).
6. **Vector dedup default state** (on, off, behind flag).
7. **Email provider** (Resend, Postmark, Azure Communication Services, SendGrid).
8. **Email sending domain.**
9. **Email status-change transition subset** (which Linear states trigger a customer email).
10. **Monitoring backend** (Logfire, Sentry, App Insights, none for v1).
11. **Hosting service finalization on Azure** (Container Apps assumed; not locked).
12. ~~**Priority matrix validation**~~ — **Resolved 2026-05-13:** draft matrix approved as-is (see Priority matrix section above).
13. ~~**Type and severity enum validation**~~ — **Resolved 2026-05-13:** both enums approved as-drafted (see Enums section above).
14. **`docs/requirements/legacy/` retention policy** (keep indefinitely vs. archive after one quarter).
15. **AGENTS.md multi-agent skill sync** (only relevant if Codex or Antigravity are used here too).

---

*End of draft.*
