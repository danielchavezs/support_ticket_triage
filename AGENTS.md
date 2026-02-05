## AGENTS Configuration for `support_ticket_triage`

This document defines the rules and architecture expectations for AI assistance and day-to-day development of the **Support Ticket Triage System**.

---

### 1) Project Overview

- **Project Name**: `support_ticket_triage`
- **Goal**: Support ticket form → automatic LLM triage → persisted ticket dashboard.
- **Key Constraints**: $0 cost (free-tier LLM), simple/working > ambitious, automated triage (no manual trigger).
- **Persistence**: Supabase Postgres (MVP uses server-side API; Auth/RLS are future improvements).

---

### 2) Agent Types and Roles


| Agent Name | Role / Responsibility                                     | Triggers / Invocation   |
| ---------- | --------------------------------------------------------- | ----------------------- |
| MainAgent  | Full-stack implementation, architecture, and docs support | Invoked on each request |


---

### 3) Tools and Integrations

- **Next.js**: App Router + Route Handlers (`app/api/**`) for required endpoints.
- **Vercel AI SDK**: LLM orchestration (structured output, optional streaming).
- **Google Gemini**: Low-cost model (configurable; prefer a Flash Lite tier).
- **Supabase**: PostgreSQL persistence (schema + migrations via SQL editor/CLI as needed).
- **Zod** *(recommended)*: Runtime validation for request payloads and LLM output.

---

### 4) Configuration Parameters (Environment Variables)

Never commit secrets. Use `.env.local` for local development.


| Key                          | Required | Scope       | Description                                     |
| ---------------------------- | -------- | ----------- | ----------------------------------------------- |
| `GOOGLE_API_KEY`             | Yes      | Server      | Google AI Studio / Gemini API key               |
| `SUPABASE_URL`               | Yes      | Server      | Supabase project URL                            |
| `SUPABASE_SERVICE_ROLE_KEY`  | Yes      | Server-only | Supabase service role key (bypasses RLS)        |
| `SUPABASE_CONNECTION_STRING` | Optional | Server-only | Postgres connection string (useful for scripts) |
| `AI_MODEL`                   | Optional | Server      | Model id (default: a Gemini Flash Lite tier)    |


---

### 5) Architecture & Boundaries

The target architecture mirrors the reference repo’s approach (Application → Features → Sources) but adapted to the assessment’s required REST endpoints.

**Application Layer (`app/`)**

- Owns routing, rendering, and the API surface.
- Implements the required endpoints in `app/api/tickets/route.ts`:
  - `POST /api/tickets`
  - `GET /api/tickets`

**Feature Layer (`services/features/`)**

- Owns business rules and orchestration:
  - Validate incoming tickets
  - Call the LLM triage pipeline
  - Persist results
  - Map errors to safe, user-friendly responses

**Sources Layer (`services/sources/`)**

- Pure integrations (no business rules):
  - Supabase DB client + queries
  - LLM provider client (Google via Vercel AI SDK)

**Rules**

- No direct DB/LLM calls from React components. Components call API routes.
- Keep all secrets server-only. Never import server modules into client components.
- Treat LLM output as untrusted input: parse + validate, fail safely.

---

### 6) Rendering Strategy (SSR/CSR)

Keep rendering simple and predictable:

- **Dashboard**: SSR for first load is fine; update via CSR refetch after submitting a ticket.
- **Form**: CSR for interactivity + loading states.
- Avoid over-optimizing (ISR/edge) unless it clearly improves the MVP.

---

### 7) Error Handling Expectations

- If the LLM fails/times out/returns invalid JSON:
  - The API returns a meaningful error (no secrets), and
  - The UI shows a clear failure state and allows retry.
- Prefer capturing “failed triage” explicitly (e.g., `triage_status = failed`) over silent drops.

---

### 8) Security & Quality Bar (MVP)

- Validate all API inputs server-side.
- Add basic security headers (reasonable defaults) if low-effort.
- Protect secrets: do not log full env vars, connection strings, or raw provider responses with sensitive content.
- Keep the code readable and explainable; prioritize separation of concerns.

---

### 9) References

- Requirements: `docs/GENERAL_DEV_PLAN.md` (includes extracted requirements + design doc sections)

---

### 10) Architecture Layers & Rules (Mandatory)

The project follows a **3-layer architecture** for separation of concerns:

```text
Application Layer (UI/API) → Feature Layer (Business Logic) → Sources Layer (Data Operations)
```

#### Sources Layer Rules (`services/sources/`)

- ✅ **Pure data operations**: direct Supabase/external calls only
- ✅ **Single responsibility**: each method does one specific operation
- ✅ **Type safety**: all public methods must be fully typed
- ❌ **NO business logic**: no validation, complex mapping, or orchestration
- ❌ **NO cross-source dependencies**: sources cannot call other sources
- ❌ **NO feature consumption**: sources cannot import from `services/features/**`
- ❌ **NO opinionated error handling**: throw raw errors; Features interpret

#### Feature Layer Rules (`services/features/`)

- ✅ **Business orchestration**: can combine multiple Sources
- ✅ **Error boundary**: catch and normalize errors into stable codes
- ✅ **Validation & transformations**: request validation, mapping, business rules
- ✅ **Observability**: add safe logging where it helps debugging
- ❌ **NO direct external calls**: must go through Sources
- ❌ **NO UI-specific logic**: keep framework-agnostic

#### Application Layer Rules (`app/`, `components/`)

- ✅ **Framework specifics**: Next.js routing, React UI, form handling
- ✅ **API boundary**: UI calls `app/api/**` routes; API routes call Features
- ❌ **NO business logic**: keep routes/components thin
- ❌ **NO direct DB/LLM calls**: no Supabase/LLM access from UI components

#### Migration / refactor guideline (if needed)

1) Start with Sources (CRUD + integration primitives)
2) Build Features (orchestration + validation + error normalization)
3) Update API/UI to consume Features
4) Add targeted tests for critical paths
5) Remove legacy code paths

---

### 11) Error Handling Contract (Recommended Pattern)

Error handling is intentionally layered and mostly non-throwing at the business boundary:

- **Sources**: throw raw provider/db errors (no mapping).
- **Features**: the main business boundary. Prefer returning a consistent result shape:

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

- **Application/API routes**: map `FeatureError.code` → HTTP status + safe JSON response.
- **UI**: render known errors as user-friendly messages; unexpected errors may throw to Next.js boundaries.

Rule of thumb: **Sources throw → Features normalize → App decides whether to display or throw**.

---

### 12) Testing Setup (Planned)

- Test runner: **Vitest**
- Focus: targeted unit tests for Feature layer (validation, LLM parsing, error mapping)
- Conventions:
  - `tests/unit/**` for pure utilities/core logic
  - Prefer mocking Sources when testing Features
- Acceptance: if tests exist, they must pass via `pnpm test`

---

### 13) Import Policy & Code Standards (Mandatory)

- **Absolute imports only** using the `@/` prefix (configured in `tsconfig.json`).
- **Relative imports are forbidden** (e.g., `../utils`, `./components`).
- **Exception (limited)**: within a tightly-coupled folder (e.g., domain factories inside the same directory), relative imports are acceptable to avoid noisy index re-exports.

Example:

```ts
// ✅ GOOD
import { createTicket } from "@/services/features/tickets";

// ❌ BAD
import { createTicket } from "../services/features/tickets";
```

---

### 14) Version Control & Database Change Tracking (Mandatory)

- Do **not** run `git commit` unless explicitly requested by the user.
- Every DB change (schema/functions/seeding) must be tracked as a SQL file under `migrations/` (create the folder if missing).
