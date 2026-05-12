# AGENTS.md : airiam-ticket-triage

Operational rules for coding agents working in this repository.

## 1. Documentation Precedence

When sources disagree, this is the order:

1. Actual code and runnable configuration in this repo.
2. `docs/DC/airiam-ticket-triage-architecture.md` (the source-of-truth doc).
3. Other docs under `docs/` (excluding `docs/requirements/legacy/`, which is historical reference only).
4. This `AGENTS.md`.
5. Other root markdown files.

`docs/requirements/legacy/` is **reference-only**. The v1.0 and v1.1 design documents in there describe a larger Customer Intake Portal scope that this project deliberately does not implement. Do not treat them as binding.

## 2. Project Identity

- **Project name:** `airiam-ticket-triage`.
- **Owner:** Daniel Chávez, Airiam Advanced Tech Division (ATD).
- **Goal:** internal triage system that receives ticket submissions from two source types (in-app submissions and, later, AIP monitoring), runs an LLM-assisted triage pipeline, deduplicates, pushes to Linear, and emails the submitter.
- **Scope guard:** this is **not** the v1.1 Customer Intake Portal in `docs/requirements/legacy/`. Read `docs/DC/airiam-ticket-triage-architecture.md` for the actual scope before starting any non-trivial work.

## 3. Stack (Locked unless flagged)

- Language: TypeScript only.
- Runtime: Next.js 16 (App Router) + React 19, single deployable serving UI and API.
- API: REST via Next.js Route Handlers under `app/api/v1/*`.
- UI: Tailwind CSS v4 + shadcn/ui. No CSS modules, no plain CSS for new work.
- Forms: react-hook-form + Zod (planned; not yet wired).
- Data client: TanStack Query (planned, only when a real client read surface exists).
- Persistence: Supabase Postgres (dedicated project per environment) with RLS and `pgvector`.
- LLM: Google Gemini via Vercel AI SDK (v1 default).
- Linear: official Linear SDK (`@linear/sdk`).
- Email: Provider interface scaffolded, concrete provider deferred.
- Testing: Vitest.
- Lint: ESLint with `eslint-config-next`.
- Type checking: `tsc --noEmit`.
- Package manager: pnpm.
- Hosting target: Azure Container Apps (planned, **not fully locked**; DevOps decision may shift).

## 4. Repository Structure

### Current

- `app/` : Next.js App Router. Pages, layouts, API Route Handlers.
- `app/api/tickets/` : REST endpoints (existing fork).
- `components/` : React UI components.
- `services/features/` : business orchestration layer.
- `services/sources/` : external integration adapters. **Pending rename to `services/providers/`.**
- `migrations/` : SQL migrations applied via the Supabase CLI.
- `tests/unit/` : Vitest unit tests.
- `assets/databaseTypes.ts` : Supabase-generated TS types.
- `types/` : Next.js generated route types plus custom types.
- `docs/DC/airiam-ticket-triage-architecture.md` : source-of-truth doc.
- `docs/DC/airiam-ticket-triage-roadmap.md` : delivery roadmap, phase order, blocker register, and progress checklist.
- `docs/requirements/legacy/` : historical reference only.

### Planned additions

- `services/providers/linear/` : Linear SDK adapter.
- `services/providers/email/` : email provider adapter.
- `services/providers/monitoring/` : monitoring backend adapter (deferred).
- `services/features/dedup/` : deduplication feature.
- `services/features/triage/` : triage orchestration (the current triage logic moves and grows here).
- `services/features/linear-sync/` : outbound push and inbound webhook handling.
- `services/features/notifications/` : email orchestration.
- `app/api/v1/linear/webhook/` : inbound webhook handler.
- `.github/workflows/` : CI/CD.

## 5. Layer Pattern (MANDATORY for new code)

Three layers. Dependency direction is strictly one-way.

```
APP (app/, components/) -> FEATURES (services/features/) -> PROVIDERS (services/providers/)
```

### App layer rules (`app/`, `components/`)

- Owns Next.js routing, rendering, form handling, API surface.
- API Route Handlers under `app/api/v1/*` are thin transport; they call Features and map results to HTTP.
- MUST NOT import Providers directly.
- MUST NOT contain business logic, validation rules, or external SDK calls.

### Feature layer rules (`services/features/`)

- Owns business orchestration: validate input, call Providers, normalize errors, persist results.
- Catches Provider errors and maps them to `FeatureError` codes.
- May call other Features when coupling is domain-local. If it would cycle, route through a higher-level orchestrator Feature instead.
- MUST NOT import from `app/` or `components/`.
- MUST NOT call external SDKs directly; always go through a Provider.

### Provider layer rules (`services/providers/`)

- One Provider per external dependency. Pure adapter: SDK call, error propagation, type marshalling.
- Each Provider exposes a TypeScript interface (Protocol-style) the Feature layer depends on.
- MUST NOT import Features or App code.
- MUST NOT call other Providers. Cross-Provider composition happens in Features.
- MUST NOT contain business logic, validation, or opinionated error handling. Throw raw provider/DB errors; Features interpret.

### Error contract

```ts
export type FeatureResult<T> =
  | { success: true; data: T }
  | { success: false; error: FeatureError };

export type FeatureError = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};
```

Pattern: **Providers throw, Features normalize, API decides HTTP status and JSON shape.**

## 6. Import Policy

- Absolute imports only, via the `@/` prefix configured in `tsconfig.json`.
- Relative imports (`./`, `../`) are forbidden in application code.
- Limited exception: within a tightly coupled folder (factory siblings inside one Provider, etc.), relative imports are acceptable to avoid noisy index re-exports.

Example:

```ts
// GOOD
import { createTicket } from "@/services/features/tickets";

// BAD
import { createTicket } from "../services/features/tickets";
```

## 7. Agent Skills Strategy

`AGENTS.md` is the primary source of project behavior. Skills are targeted accelerators; they reinforce these rules, they do not override them.

### Vercel-style prompting protocol (required for non-trivial work)

1. Explore relevant project files and current implementation state first.
2. Select only the skill(s) that match the discovered task context.
3. State in the prompt which skill is being used and why.
4. Execute the task with the skill guidance while preserving project rules in this `AGENTS.md`.
5. Verify outcomes and summarize what changed, what was tested, and what was deferred.

Keep prompts concrete and scoped: objective, constraints, files, expected outputs, verification commands.

### Skill routing protocol (default chains)

| Task type | Default skill chain |
|---|---|
| Next.js / App Router / RSC boundaries | `$next-best-practices` -> `$react-best-practices` |
| Building UI components (primitives, accessibility, design tokens) | `$building-components` -> `$shadcn` -> `$vercel-composition-patterns` |
| Component API refactors | `$vercel-composition-patterns` -> `$react-best-practices` |
| Form work (react-hook-form + Zod) | `$react-best-practices` |
| REST API design | `$api-design-principles` -> `$error-handling-patterns` |
| Postgres schema and indexing | `$postgresql` -> `$sql-optimization-patterns` |
| LLM features via Vercel AI SDK | `$ai-sdk` |
| Anthropic / Claude direct integration | `$claude-api` |
| CI/CD workflows | `$github-actions-templates` |
| Debugging | `$systematic-debugging` |
| Pre-PR / pre-merge review | `$verification-before-completion` -> `$simplify` -> `$polish` |
| UI design review | `$web-design-guidelines` |
| Azure infrastructure preparation (when in scope) | `$azure-prepare` -> `$azure-validate` -> `$azure-deploy` |
| Azure production troubleshooting | `$azure-diagnostics` + `$systematic-debugging` |
| Cache strategy (Next.js cacheLife / cacheTag) | `$next-cache-components` |
| Tailwind / design tokens | `$tailwind-design-system` |
| Component design system audit | `$web-design-guidelines` -> `$building-components` |

When multiple skills apply, state the execution order explicitly in the prompt before doing the work. If a task matches one of the routed cases above, treat the corresponding skill selection as the default, not optional guidance.

If a routed skill is not installed or not available to the active agent, say so briefly and continue with the nearest available skill plus this repository's rules. Do not block implementation solely because a helper skill is missing.

### Skills explicitly NOT used here

- All Python skills (`$python-testing-patterns`, `$async-python-patterns`, etc.). This is a TS-only project.
- `$entra-app-registration`. No Entra ID auth in v1.
- `$react-state-management`. Use only if a real shared-state need emerges; not required by the current scope.
- `$next-upgrade`. Greenfield Next.js 16, no upgrade path.

### Multi-agent skill sync

This repository uses **Claude Code** as the primary coding agent. If Codex or Antigravity are added later, follow the symlink pattern from the design-team-rag project:

| Agent | Personal skills path | Project skills path |
|---|---|---|
| Claude Code | `~/.claude/skills/<skill>/SKILL.md` | `.claude/skills/` |
| Codex | `~/.codex/skills/<skill>/SKILL.md` (symlink) | `.codex/skills/` |
| Antigravity | `~/.gemini/antigravity/skills/<skill>/SKILL.md` (symlink) | `.agents/skills/` |

This section is informational until a second agent is actually used in this repo.

## 8. Branching and PR Workflow

- Branch from latest `dev`.
- Feature branches: `feature/<short-description>`.
- Open PRs against `dev`. Merge `dev -> main` only through reviewed PR / release flow.
- No direct pushes to `dev` or `main`.
- Every commit and PR references a Linear ticket where one exists.
- Agents (Claude Code or any other) **never** approve a PR. Human approval is mandatory.

### PR template (minimum content)

- What changed and why.
- Linear ticket reference, or explicit `N/A`.
- Testing and verification performed (commands, screenshots, manual checks).
- Reviewer notes for any non-obvious decisions or intentional gaps.

## 9. Testing and Validation

### Tooling

- Test runner: Vitest.
- Mocks: prefer mocking Providers when testing Features.
- Test location: `tests/unit/**` for pure utilities and core logic; future `tests/integration/**` for full route handler flows.

### Minimum local checks before opening a PR

- `pnpm lint`
- `pnpm typecheck` (or `tsc --noEmit` if no script alias yet)
- `pnpm test`
- `pnpm build`

### Coverage policy

- Minimum: **70%** lines, branches, functions, statements (enforced once CI is wired).
- Target: **85%**.

### Prioritize tests for

- The triage Feature: classification result handling, fallback paths, retry.
- The dedup Feature: deterministic-hash collisions and vector-similarity threshold behavior.
- The Linear push Feature: success, transient failure, signature verification on inbound webhooks.
- RLS-relevant DB access paths once the user-JWT route is wired.
- Email confirmation and status-change trigger logic.
- Any auth / authz path that touches `org_id` or `user_id` resolution.

## 10. Environment Variables

Never commit secrets. Use `.env.local` locally. Use Azure environment-scoped secrets in deployed environments.

| Key | Required | Scope | Description |
|---|---|---|---|
| `SUPABASE_URL` | Yes | Server | Supabase project URL. |
| `SUPABASE_ANON_KEY` | Yes | Server | Supabase anon key for non-admin paths. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-only | Service-role key for admin paths only. **Never expose to the browser.** |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Yes | Server | Google Generative AI / Gemini API key. |
| `AI_MODEL` | Optional | Server | Override for the default Gemini model (default: `gemini-2.5-flash-lite`). |
| `LINEAR_API_KEY` | Yes (once Linear feature lands) | Server | Linear API key, scoped to the ATD workspace. |
| `LINEAR_TEAM_ID` | Yes (once Linear feature lands) | Server | Target Linear team identifier. |
| `LINEAR_WEBHOOK_SECRET` | Yes (once inbound webhook lands) | Server | Shared secret for Linear webhook signature verification. |
| `EMAIL_PROVIDER_API_KEY` | TBD | Server | Provider key once chosen. |
| `EMAIL_SENDER` | TBD | Server | Sending address. |
| `IN_APP_CALLER_HMAC_SECRET` | TBD | Server | Shared secret for in-app caller HMAC, once that mechanism is locked. |

Server-only vars never use the `NEXT_PUBLIC_` prefix. Browser-exposed vars must use `NEXT_PUBLIC_`.

## 11. Security and Secrets

- Never commit secrets, keys, tokens, passwords, or real credentials.
- Treat LLM output as untrusted input: parse and validate with Zod.
- Do not log full env vars, connection strings, or raw provider responses containing sensitive content.
- Service-role Supabase access is constrained to specific Features. Not the blanket default.
- RLS is enabled on every org-scoped table from migration day one. Service-role bypass is intentional and tracked.
- Until user-JWT request paths exist, every service-role read/write must require trusted `org_id` / `user_id` context and apply explicit scoping in the Provider or repository method.
- Production secrets are never accessible from dev contexts.

## 12. Database Change Tracking

- Every DB change (schema, functions, seeding) is a SQL file under `migrations/`.
- File naming: `YYYY-MM-DD_<short_description>.sql`.
- One migration per logical change. Do not amend prior migrations once applied to a deployed environment.
- Do **not** run `git commit` unless explicitly requested by the user.

## 13. Code Standards

- TypeScript strict mode (already on; do not relax).
- Tailwind for all styling. No plain CSS or CSS modules in new work.
- No `OLD`, `backup`, or duplicate-variant files in normal implementation flow.
- Prefer descriptive file names over generic ones (`triagePipeline.ts`, not `service.ts`) when a feature folder grows.
- Public Features and Providers carry a one-paragraph file-level docstring explaining the boundary and any non-obvious constraints.

## 14. Code Commenting Guidelines

- Comments explain the **why** and the non-obvious **how**, not the **what**.
- Avoid commenting small, self-explanatory helpers. Let names and types do the talking.
- Public interfaces (exported types, Feature entry points, API route handlers) have meaningful docstrings.
- Add inline comments for: complex state management, intricate data transformations, integration quirks, security checks, RLS interactions.

## 15. Review and Change Discipline

- When reviewing PRs, prioritize: bugs, logic errors, security issues, RLS / authz regressions, missing tests for new logic.
- Infrastructure, deployment, and CI workflow changes deserve explicit human review even when technically correct.
- Architecture decisions are surfaced in the source-of-truth doc, PR notes, or the decision register. They are never made silently.

## 16. Definition of Done

A change is done when:

1. New behavior is wired through the App / Features / Providers layers correctly (no shortcuts).
2. RLS policies are correct for any new org-scoped table.
3. Migrations (if any) are created under `migrations/` and applied locally.
4. Required env vars (if any) are added to `.env.local.example` (to be created) and to the env var table in this `AGENTS.md`.
5. Tests cover the new logic at the Feature layer at minimum.
6. Local verification ran clean: `pnpm lint`, `pnpm typecheck` (or `tsc --noEmit` until the alias exists), `pnpm test`, `pnpm build`.
7. Any intentional gaps (stubs, TODOs, deferred integrations) are explicitly noted in the PR description.
8. The source-of-truth doc is updated in the same change set if architecture-relevant behavior changed.

## 17. Indexing for Agents

When starting a non-trivial task, orient by reading, in this order:

1. `docs/DC/airiam-ticket-triage-architecture.md` for scope and locked decisions.
2. `docs/DC/airiam-ticket-triage-roadmap.md` for phase order, open blockers, and current progress.
3. This `AGENTS.md` for rules.
4. The relevant Feature or Provider module's file-level docstring.
5. The relevant migration file(s) for schema context.
6. `package.json` for available scripts and dependencies.

Avoid orienting from files in `docs/requirements/legacy/`. They describe a different (larger) project and will mislead.

---

*Last updated: 2026-05-12. Update in the same change set as architecture-relevant behavior changes.*
