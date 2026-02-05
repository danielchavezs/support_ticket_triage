# Support Ticket Triage System

Full-stack Next.js app where a customer submits a support ticket, the backend automatically runs **LLM triage** (priority + category) and generates a suggested response, and a dashboard lists all submitted tickets.

## Features

- Ticket submission form (required): **customer name**, **email**, **subject**, **description**
- Automated AI triage on submit:
  - Priority: `Critical` | `High` | `Medium` | `Low`
  - Category: `Billing` | `Technical` | `Account` | `General`
  - Suggested customer-facing response
- Ticket dashboard with list + details view
- Persistence via **Supabase Postgres**
- Backend API:
  - `POST /api/tickets`
  - `GET /api/tickets`

## Stack

- Next.js (App Router) + React + TypeScript
- Tailwind CSS
- Vercel AI SDK + Google Gemini (free tier)
- Supabase (PostgreSQL) for persistence

## Architecture (3-layer)

- **Application layer**: `app/` routes + `app/api/**` route handlers
- **Feature layer**: `services/features/**` business logic (triage pipeline)
- **Sources layer**: `services/sources/**` integrations (Supabase, LLM provider)

See `AGENTS.md` for rules and conventions.

## Routes

- Submit ticket: `/`
- Dashboard: `/dashboard`

## Local setup

### 1) Install dependencies

```bash
pnpm install
```

### 2) Environment variables

Create `.env.local` (recommended) or `.env` with:

```bash
# LLM
# Recommended
GOOGLE_GENERATIVE_AI_API_KEY=...
# Or (legacy naming used by some setups)
GOOGLE_API_KEY=...

# Optional (defaults to gemini-2.5-flash-lite)
AI_MODEL=gemini-2.5-flash-lite

# Supabase (server / API routes)
SUPABASE_URL=...
# Either one is enough (both are the *anon* key):
SUPABASE_ANON_KEY=...
# or
NEXT_PUBLIC_SUPABASE_ANON_KEY=...

# Supabase (browser) — only needed if/when client components call Supabase directly
NEXT_PUBLIC_SUPABASE_URL=...

# Optional (server-only; reserved for admin workflows / future RLS setup)
SUPABASE_SERVICE_ROLE_KEY=...
```

Notes:

- `SUPABASE_SERVICE_ROLE_KEY` is **server-only**. Never expose it to the browser.
- In Next.js, env vars prefixed with `NEXT_PUBLIC_` are safe to expose to the browser. Server-only env vars should not use that prefix.

### 3) Supabase schema

Apply the initial schema in your Supabase project:

- Open Supabase → SQL editor
- Run `migrations/2026-02-05_create_tickets.sql`

### 4) Run the app

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

- Dev server: `pnpm dev`
- Lint: `pnpm lint`
- Tests: `pnpm test`
- Build: `pnpm build`
- Start: `pnpm start`

## Scope notes

- MVP keeps the dashboard public; Auth/RLS are documented as future improvements.
- Streaming AI output is optional; ship a non-streaming path first, then add streaming.
