# airiam-ticket-triage

Internal ticket triage system owned by the Airiam Advanced Tech Division (ATD). Receives ticket submissions, runs an LLM-assisted triage pipeline, deduplicates, pushes to Linear, and emails the submitter.

This README is a getting-started guide. For scope, architecture, and locked decisions see the source-of-truth docs below.

## Source of truth

When this README disagrees with the docs below, the docs win.

1. [`docs/DC/airiam-ticket-triage-architecture.md`](docs/DC/airiam-ticket-triage-architecture.md) — scope, layers, schema, locked decisions.
2. [`docs/DC/airiam-ticket-triage-roadmap.md`](docs/DC/airiam-ticket-triage-roadmap.md) — delivery phases, decision blockers, progress checklist.
3. [`AGENTS.md`](AGENTS.md) — rules for coding agents and humans working in this repo.

## Stack

- TypeScript, Next.js 16 (App Router) + React 19, single deployable serving UI and REST API.
- Tailwind CSS v4 + shadcn/ui (planned).
- Vercel AI SDK + Google Gemini (v1 default).
- Supabase Postgres (dedicated project per environment) with RLS and `pgvector`.
- Linear SDK (`@linear/sdk`) — once Phase 4 lands.
- Vitest for tests, ESLint via `eslint-config-next`, pnpm for package management.

## Architecture (3 layers, one-way dependencies)

- **App** (`app/`, `components/`) — Next.js routes, layouts, components, API route handlers under `app/api/*`.
- **Features** (`services/features/**`) — business orchestration. Calls Providers, normalizes errors.
- **Providers** (`services/providers/**`) — one adapter per external dependency (Supabase, LLM, Linear, email).

See the architecture doc for the full layer contract.

## Routes

- Submit ticket: `/`
- Dashboard: `/dashboard`
- API base: `/api/`

## Local setup

### 1) Install dependencies

```bash
pnpm install
```

### 2) Environment variables

Copy the template and fill in your values:

```bash
cp .env.local.example .env.local
```

`.env.local` is gitignored. Never commit secrets. The template lists every key the project uses today plus the ones that activate as future phases (Linear, email, caller HMAC) land. Authoritative env reference: `AGENTS.md` §10.

### 3) Supabase schema

No schema exists yet. Phase 1 lands the v1 tables (`orgs`, `users`, `tickets`, `ticket_events`, `dedup_signatures`) plus RLS policies via SQL migrations under `migrations/`, applied to a fresh Supabase project per the architecture doc.

Until Phase 1 lands, the app cannot persist tickets end-to-end against a real Supabase project. The current code still references Provider methods that expect a schema that has not been created.

### 4) Run the app

```bash
pnpm dev
```

Open <http://localhost:3000>.

## Scripts

- `pnpm dev` — dev server
- `pnpm build` — production build
- `pnpm start` — start the built app
- `pnpm lint` — ESLint
- `pnpm typecheck` — `tsc --noEmit`
- `pnpm test` — Vitest, single run
- `pnpm test:watch` — Vitest in watch mode
- `pnpm gen-types` — regenerate Supabase TypeScript types into `assets/databaseTypes.ts`

## Pre-PR verification

Before opening a PR, run all four locally:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

CI will enforce the same gates once Phase 8 lands (see roadmap).
