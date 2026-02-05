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

See `AGENTS.md` for rules and conventions, and `docs/GENERAL_DEV_PLAN.md` for the design doc and implementation notes.

## Local setup

### 1) Install dependencies

```bash
pnpm install
```

### 2) Environment variables

Create `.env.local` (recommended) or `.env` with:

```bash
# LLM
GOOGLE_API_KEY=...

# Supabase
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

Notes:

- `SUPABASE_SERVICE_ROLE_KEY` is **server-only**. Never expose it to the browser.
- `SUPABASE_CONNECTION_STRING` is optional (useful for scripts/migrations), but should also remain server-only.

### 3) Supabase schema

Create the required tables in your Supabase project (see `docs/GENERAL_DEV_PLAN.md` for the initial SQL).

### 4) Run the app

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

- Dev server: `pnpm dev`
- Lint: `pnpm lint`
- Build: `pnpm build`
- Start: `pnpm start`

## Scope notes

- MVP keeps the dashboard public; Auth/RLS are documented as future improvements.
- Streaming AI output is optional; ship a non-streaming path first, then add streaming.
