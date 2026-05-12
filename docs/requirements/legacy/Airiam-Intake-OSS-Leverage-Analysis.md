# Airiam Customer Intake Portal: Open-Source Leverage Analysis

**Document type:** Companion to v1.1 design doc
**Prepared by:** Greg Williams / Airiam Advanced Technologies
**Status:** Reference

This is a concrete answer to one question: what existing open-source code, libraries, or reference architectures should we leverage to either improve quality or move faster, and where is it not worth it? Not a list of "things that exist." A ranked list of things with specific time-savings or quality-improvements claimed against the v1.1 sprint plan.

---

## 1. Summary: What This Saves Us

If we adopt all of the Tier 1 and Tier 2 recommendations below, the realistic effort reduction across the v1 build is roughly:

| Sprint | Original estimate | With OSS leverage | Savings |
|--------|--------------------|---------------------|---------|
| 1 | 2 weeks | 1.5 weeks | 0.5 wk |
| 2 | 2 weeks | 1.5 weeks | 0.5 wk |
| 3 | 1 week | 1 week | 0 |
| 4 | 1 week | 0.5 week | 0.5 wk |
| 5 | 1 week | 0.5 week | 0.5 wk |
| **Total** | **7 weeks** | **5 weeks** | **2 weeks** |

The savings concentrate in two places: (a) the embedded widget (sprint 4), where Sentry's open-source widget architecture is directly applicable, and (b) the eval harness (sprint 5), where deepeval and promptfoo eliminate weeks of bespoke harness work.

The qualitative improvements are larger than the time savings: better observability via Logfire and OTel, better auth correctness via fastapi-azure-auth's battle-tested patterns, and better triage accuracy via deepeval's structured testing.

---

## 2. Tier 1: Direct Dependencies (Install and Use)

These are things we add to `pyproject.toml` or `package.json` and use directly. All are MIT or compatible licenses; all are actively maintained.

### 2.1 Backend (Python / FastAPI)

| Package | License | What it gives us | Effort saved |
|---------|---------|--------------------|---------------|
| `pydantic-ai` | MIT | Triage agent framework with structured outputs, OTel built in | ~3 days vs. rolling our own LLM client + retry + validation |
| `fastapi-azure-auth` (Intility) | MIT | Entra External ID / B2C JWT validation, multi-tenant issuer fetching, OpenAPI integration | ~3 days vs. writing JWT validation against Entra metadata endpoints |
| `gql` + `httpx` | MIT / BSD | GraphQL client to Linear; Python ecosystem doesn't have an official Linear SDK but the GraphQL surface is small | ~1 day vs. rolling raw `requests` calls; we get schema validation for free |
| `microsoft-presidio` | MIT | PII detection and redaction; already in the AIP stack | (already paid) |
| `azure-messaging-webpubsubservice` (Microsoft) | MIT | Web PubSub server SDK for issuing client tokens and broadcasting | ~2 days vs. signing JWTs by hand |
| `azure-servicebus` (Microsoft) | MIT | Service Bus topics/subscriptions; AIP standard | (already paid) |
| `azure-keyvault-secrets` (Microsoft) | MIT | Secret retrieval at startup | (already paid) |
| `slowapi` | MIT | Rate limiting per route, per principal, per IP | ~1 day vs. building token-bucket middleware |
| `alembic` | MIT | Schema migrations | ~1 day; already standard |
| `sqlmodel` | MIT | Pydantic-aligned ORM; AIP standard | (already paid) |
| `structlog` + `logfire` | Apache 2 / MIT | Structured logging that flows into OTel and Pydantic Logfire | ~2 days vs. raw stdlib logging plus correlation work |
| `opentelemetry-instrumentation-fastapi` | Apache 2 | Drop-in OTel for FastAPI; auto-spans every request | ~1 day vs. manual span instrumentation |

Sample install line for the API service:

```toml
# services/customer-intake/api/pyproject.toml
dependencies = [
  "fastapi[standard]>=0.115",
  "uvicorn[standard]>=0.32",
  "sqlmodel>=0.0.22",
  "alembic>=1.14",
  "asyncpg>=0.30",
  "pydantic>=2.10",
  "pydantic-settings>=2.7",
  "pydantic-ai>=0.6",
  "fastapi-azure-auth>=5.0",
  "azure-messaging-webpubsubservice>=1.2",
  "azure-servicebus>=7.13",
  "azure-keyvault-secrets>=4.9",
  "presidio-analyzer>=2.2",
  "presidio-anonymizer>=2.2",
  "gql[httpx]>=3.5",
  "httpx>=0.28",
  "slowapi>=0.1.9",
  "structlog>=24.4",
  "logfire>=2.0",
  "opentelemetry-instrumentation-fastapi>=0.50b0",
]
```

### 2.2 Frontend (Next.js 15 / TypeScript)

| Package | License | What it gives us | Effort saved |
|---------|---------|--------------------|---------------|
| `@linear/sdk` | MIT | Official, code-generated, fully-typed Linear SDK; ~1.2M weekly downloads; published by Linear | ~2 days vs. rolling our own typed GraphQL client |
| `@azure/web-pubsub-client` | MIT | Official client for Web PubSub; handles reconnection, group join, token refresh | ~2 days vs. raw WebSocket lifecycle code |
| `@azure/msal-browser` + `@azure/msal-react` | MIT | Customer Portal Account login flow (Entra External ID) on the React side | ~2 days vs. raw OAuth dance |
| `react-hook-form` + `zod` | MIT | Form validation that mirrors our Pydantic schemas | ~1 day; standard |
| `@tanstack/react-query` | MIT | Data fetching with retries, cache, optimistic updates | ~1 day; standard |
| `tailwindcss` + `shadcn/ui` | MIT / MIT | Component library; AIP-standard | (already paid) |

### 2.3 Embedded Widget (Tier 1 critical, deep-dived in §5)

| Package | License | What it gives us |
|---------|---------|---------------------|
| `preact` (~4.5kB) | MIT | Tiny React-compatible runtime; the basis of the embedded widget |
| `html-to-image` | MIT | Optional screenshot capture for the embedded widget |

---

## 3. Tier 2: Reference Architectures (Mirror, Don't Fork)

These are projects whose source we read carefully and whose architectural decisions we adopt, but whose code we don't pull in directly, either because of license incompatibility, framework mismatch, or too much surface area.

### 3.1 `tiangolo/full-stack-fastapi-template` (MIT)

This is the canonical FastAPI + SQLModel + Postgres + Docker template, maintained by Sebastián Ramírez (FastAPI's creator). Latest release Q4 2025.

**What we mirror:** project layout (`app/api/routes`, `app/core/config.py`, `app/models`, `app/crud`), the dependency injection pattern for the database session, the migration scaffolding, the Docker structure, the GitHub Actions CI pipeline.

**What we don't take:** their auth (we have our own four-strategy resolver), their frontend (we use Next.js 15 not React + Vite), their CRUD patterns (we have richer event-sourced patterns).

**Time saved:** ~1 day in sprint 1. Pedro and Daniel both know this layout already, but copying the structure is faster than redesigning it.

### 3.2 `iam-abbas/FastAPI-Production-Boilerplate` (MIT)

Same idea as the tiangolo template but with a more mature row-level access control module and a cleaner Principal/scope pattern.

**What we mirror:** the access-control decorator pattern they use to enforce per-route scopes against a Principal object. Maps almost one-to-one to our auth design from v1.1 §5.

**Time saved:** ~1 day in sprint 1.

### 3.3 Sentry's User Feedback Widget (BSL 1.1, source-available)

License note: Sentry's main code is BSL 1.1, which is source-available but commercially restricted. We do not vendor any of their code. We use their public engineering blog post and their public docs as a reference for architectural decisions.

**What we mirror:** the entire architecture of an embeddable feedback widget. See §5 for the deep dive.

**Time saved:** ~3 days in sprint 4. This is the single largest leverage point in the OSS analysis.

### 3.4 Microsoft's Common Alert Schema Documentation

This is documentation, not code, but it saves real engineering time.

**What we mirror:** the standardized payload format for Azure Monitor webhooks. We don't have to invent a payload contract for the App Insights adapter; Microsoft already did. Our adapter is a 50-line Pydantic model that maps the standard schema fields into our `Ticket` model.

**Time saved:** ~1 day in sprint 2.

### 3.5 Linear's GraphQL Schema (MIT, in `linear/linear` repo)

Linear publishes the production schema directly. We can use it for local validation, codegen, and as documentation.

**What we mirror:** we can generate Python types from the schema if we want them. For v1, manual typing of the four mutations we use (`issueCreate`, `commentCreate`, `webhookCreate`, `issueUpdate`) is faster than wiring full codegen.

**Time saved:** ~0.5 day; included in the Linear integration estimate.

---

## 4. Tier 3: Eval and Testing Tooling (CI and Sprint 5)

This is where the largest quality improvement comes from, and the second largest time savings.

### 4.1 `confident-ai/deepeval` (Apache 2)

Pytest-style LLM unit testing. Treats evals as `pytest` tests, which means they run in our existing CI pipeline with no new infrastructure.

**What we use it for:**

- **Triage accuracy on the eval set.** Each labeled historical ticket becomes a `pytest` case; the test asserts the AI's classification matches the human label.
- **Hallucination check on rationale.** DeepEval's hallucination metric verifies the rationale field is grounded in the input ticket text.
- **Regression detection.** Every PR that touches the prompt or the agent runs the full eval suite; CI fails if accuracy regresses.

**Sample test:**

```python
# tests/eval/test_triage_accuracy.py
import pytest
from deepeval import assert_test
from deepeval.metrics import GEval
from deepeval.test_case import LLMTestCase

@pytest.mark.parametrize("case", load_eval_set())
def test_triage_classification(case):
    result = await triage_agent.run(case.ticket_text)

    test_case = LLMTestCase(
        input=case.ticket_text,
        actual_output=result.ticket_type,
        expected_output=case.expected_ticket_type,
    )

    accuracy_metric = GEval(
        name="Classification Accuracy",
        criteria="Determine whether the actual classification matches the expected.",
        threshold=0.9,
    )
    assert_test(test_case, [accuracy_metric])
```

**Time saved:** ~3 days in sprint 5. Building a custom eval harness with metrics, reporting, and CI integration is roughly that much.

### 4.2 `promptfoo/promptfoo` (MIT)

YAML-driven prompt and model comparison; used by OpenAI and Anthropic per their own documentation.

**What we use it for:**

- **Model bake-offs.** When we want to compare GPT-4o vs. GPT-4o-mini vs. Gemini 2.5 Flash vs. Claude on the same eval set, promptfoo runs all of them in parallel and produces a comparison matrix.
- **Threshold tuning.** Sweep the confidence threshold (0.5, 0.6, 0.7, 0.8, 0.9) and see the precision/recall curve.
- **Prompt regression on changes.** A YAML diff on the prompt produces a YAML diff on the eval results.

**Recommendation:** use deepeval for CI (Python-native, runs in sprint-5 onwards), use promptfoo for one-off bake-offs when we're considering model swaps. Both, not either.

**Time saved:** ~2 days in sprint 5 plus ongoing throughout v1.1+.

### 4.3 `pydantic/logfire` (MIT)

Already in our stack as the Pydantic AI observability layer. Worth calling out explicitly because it gives us OTel spans per LLM call, including the prompt, the response, the cost, the latency, and the structured-output validation result, all without writing instrumentation code.

**What it adds:** a dashboard where we can see per-customer triage accuracy, per-model cost over time, and any agent that returned `InsufficientContext` so we can investigate the bad cases.

**Time saved:** built into Pydantic AI; cost is configuring it.

---

## 5. Embedded Widget Deep Dive: The Sentry Pattern

This is the highest-leverage open-source insight in the analysis, so it deserves its own section.

### 5.1 The Problem

We need an embeddable "Open a Ticket" widget that drops into apps Airiam built (BDT, AIP, OSCAR, FinOps, AR/AP). The widget has to:

- Work in any host framework (these apps use a mix of React, Next.js, possibly some legacy templates)
- Not collide with the host app's CSS
- Be small enough that hosting apps don't push back on bundle size
- Capture the user's identity from the host app
- Capture optional structured context (current page, user state, recent actions)
- Optionally capture a screenshot
- Submit via HMAC to our API
- Show submission confirmation

This is Sentry's user-feedback-widget problem almost exactly. They've solved it in production for hundreds of thousands of apps.

### 5.2 What We Adopt From Sentry's Architecture

From their public engineering blog post, the architecture decisions are:

1. **Preact, not React.** Preact is ~4.5kB, React is ~45kB. The widget runs in any host without forcing a React version on it.
2. **Shadow DOM for CSS isolation.** The widget's styles are encapsulated and cannot conflict with the host app. This is non-negotiable for a drop-in widget.
3. **Two distribution modes:** auto-injected floating button (one line of code in the host) and `attachTo(button)` for hosts that want to control placement.
4. **Lazy-load the form.** The button itself is small; the form code only loads when the user clicks. Significantly cheaper bundle impact on the host.
5. **Screenshot via `html-to-image` (or equivalent).** The user can optionally attach a screenshot of the current view.
6. **Configuration over code.** All copy, theming, required fields, and submission endpoint configurable via init options.

### 5.3 What This Looks Like in Our Build

```javascript
// In any Airiam-built app:
import { initAiriamIntake } from '@airiam/intake-widget';

initAiriamIntake({
  apiEndpoint: 'https://intake.airiam.com/v1/tickets',
  appId: 'bdt-platform',
  apiKey: process.env.NEXT_PUBLIC_INTAKE_PUBLIC_KEY, // public-safe; HMAC happens server-side via a proxy
  user: { id: currentUser.id, email: currentUser.email },
  context: () => ({ currentRoute: window.location.pathname, version: APP_VERSION }),
  onSubmitted: (ticketId) => {
    // optional: show app-specific success UI
  },
});
```

### 5.4 The HMAC Question for Browser Code

We can't ship the HMAC secret to the browser. The pattern is:

1. The host app exposes a small server-side proxy endpoint (e.g., `/api/intake-proxy`) that adds the HMAC signature using a server-side secret.
2. The widget calls the host's proxy; the proxy calls our `/v1/tickets` with HMAC.
3. The user's identity and `app_context` ride along; the host's proxy treats them as trusted because they came from the host's authenticated session.

Each Airiam app already has a backend; this is a 30-line proxy route per app. The widget itself stays public.

### 5.5 Why This Cuts Sprint 4 in Half

Without the Sentry pattern reference, sprint 4 is "design and build a widget framework from scratch." With the reference, sprint 4 is "implement the well-known pattern with our config and our endpoint." The former is research-heavy; the latter is execution.

Concretely: 5 days of work becomes 2.5 days of work, with a better outcome because we're standing on a battle-tested architecture rather than discovering pitfalls ourselves.

---

## 6. Tier 4: What We Don't Take and Why

Honesty matters here. Not every "thing that exists" is worth using.

| Project / approach | Why we don't take it |
|---------------------|------------------------|
| **Plane** (makeplane/plane) | AGPL-3.0. Forces source disclosure of any derivative we host. Architecturally we're not building a Linear competitor anyway. |
| **Open Ticket AI** | Likely AGPL; designed as a multi-system orchestrator we don't need; we're committed to Linear as the dev-side system of record. |
| **Self-hosting Chatwoot or Zammad** | Massive footprint for the small slice of functionality we'd actually use; ongoing operational burden; we'd be running a full helpdesk platform to power 100 tickets a day. |
| **Replacing RAIVS with an OSS audit-chain library** (`attest`, `chronicle`, `python-hash-chain-logging-system`, etc.) | Several decent OSS implementations exist (Attest is the cleanest), but RAIVS is patent-pending and already in production in OSCAR. Switching would lose IP value, lose Greg's institutional context, and provide no functional benefit. |
| **Linear Python SDKs** (`linear-sdk`, `linear-python` from third parties) | Both are partial, neither is maintained by Linear. The Linear team explicitly says "use the GraphQL API directly" if you're not in TypeScript. We follow that guidance. |
| **`langchain` / `langgraph`** | Pydantic AI is a tighter, more typed framework that aligns with the rest of our stack. Adding LangChain on top would be net-negative complexity. |
| **`crewai`, `autogen`** | Multi-agent orchestration frameworks; we don't have a multi-agent problem yet. v3 might revisit. |
| **`llama-index`** | Useful if we were building heavy RAG infrastructure; for v2's single-corpus pgvector retrieval we don't need it. We can pick it up in v3 if RAG complexity grows. |
| **Vendor SaaS for AI eval** (Galileo, Patronus, LangSmith) | All charge per-eval; deepeval+promptfoo are free, run in our own pipeline, and produce identical outputs. Revisit only if the volume justifies a managed service. |

---

## 7. Reference Code We Read but Don't Vendor

Worth Greg or Daniel skimming for ideas, even though we won't pull the code:

- **`vstorm-co/full-stack-ai-agent-template`**: modern FastAPI + Next.js + Pydantic AI scaffolding. Useful as a sanity check that we're not missing an obvious pattern.
- **`vigneshjd/camel-support--ticket-triage-agent`**: Apache Camel + Java triage system. Their JSON output schema for triage results is good; we already mirror it conceptually.
- **GitHub Security Lab Taskflow Agent**: internal LLM-based triage of CodeQL alerts. Useful for v3 thinking about templated prompts iterated across many tickets.
- **`realm-security/agent-union-type`**: already cited in v1.0; the union-type uncertainty pattern we adopted.

---

## 8. Updated Sprint Plan With OSS Acceleration

Same plan as v1.1 §11, with explicit OSS dependencies called out per sprint.

| Sprint | Deliverables (unchanged) | OSS leverage | Net duration |
|--------|---------------------------|----------------|----------------|
| 0 | Architecture review, ADRs locked, Linear OAuth apps, Entra tenants, secrets seeded | (none) | 1 week |
| 1 | API skeleton, Customer Portal Accounts via Entra External ID, DB schema, Web PubSub provisioned, Bicep | tiangolo template structure, fastapi-azure-auth, azure-messaging-webpubsubservice | 1.5 weeks |
| 2 | Triage worker, Pydantic AI agent, Presidio, fast filter, full triage, priority calc, Linear push, monitoring adapters (N-able / App Insights / Sentry) | pydantic-ai, gql, microsoft-presidio, Common Alert Schema docs | 1.5 weeks |
| 3 | Linear webhook listener, status-change events, email + Web PubSub fanout, customer status page | @azure/web-pubsub-client | 1 week |
| 4 | Embedded widget reference implementation, embedded auth, documentation | Preact, Shadow DOM, Sentry widget architecture pattern | 0.5 week |
| 5 | Eval set built (50-100 tickets), accuracy measurement, threshold tuning, dashboards, SOC2 readiness checklist | deepeval (CI), promptfoo (bake-offs), Logfire | 0.5 week |
| 6 | Beta launch into Airiam tenant; Canopy tenant deployment dry run | (azd, Bicep parameter files) | 1 week |

**Total: 5 weeks of focused build work** versus the original 7. The compressed sprints 4 and 5 are the biggest beneficiaries.

---

## 9. Recommended Decision

Approve the Tier 1 dependencies as the working dependency list for sprints 1-3. Approve the Tier 3 eval tooling (deepeval + promptfoo) as part of sprint 5. Schedule a 30-minute pairing session between Greg and Pedro before sprint 4 to walk through the Sentry widget architecture so Pedro starts that sprint with the pattern in hand rather than discovering it during the sprint.

Skip the Tier 4 list. Don't relitigate.

---

*End of document.*