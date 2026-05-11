# Airiam Customer Intake Portal: Research Findings (Reference)

**Document type:** Reference / Internal
**Purpose:** Consolidated factual findings from the v1.0 and v1.1 research phase, packaged for offline reference in the Claude Project.
**Status:** Snapshot as of design-phase research (May 2026).

This document is a compressed reference for the Claude Project, which does not have web access. Use it to answer factual questions about Linear, ITIL, Azure services, AI triage patterns, Sentry's widget architecture, and OSS projects we considered. If a question is not covered here, say so rather than inventing specifics.

---

## 1. Linear: API, Webhooks, and Native Capabilities

### 1.1 API Basics

- **Endpoint:** `https://api.linear.app/graphql` (GraphQL only; no REST).
- **Authentication:** API keys (workspace-scoped or personal) or OAuth 2.0. For service-to-service work, API keys are simplest. For multi-org applications (not our case), OAuth 2.0 is recommended.
- **Auth header:** `Authorization: Bearer <ACCESS_TOKEN>` for OAuth, or just the key as the `Authorization` value for API keys (no `Bearer` prefix for personal API keys per Linear's docs).
- **Rate limits:**
  - API key auth: 1,500 requests per hour per user
  - OAuth app auth: 500 requests per hour per user/app
  - Unauthenticated: 60 requests per hour per IP
  - Plus complexity-based limits: 250,000 complexity points/hour for API key auth
- **Schema introspection:** the production schema is queryable via Apollo Studio without login. Schema is also published in the `linear/linear` GitHub repo at `packages/sdk/src/schema.graphql`.

### 1.2 Issue Creation Mutation

```graphql
mutation IssueCreate {
  issueCreate(
    input: {
      title: "Title"
      description: "Markdown body"
      teamId: "TEAM_UUID"
      priority: 1                    # 1=Urgent, 2=High, 3=Medium, 4=Low, 0=No priority
      labelIds: ["LABEL_UUID_1"]
      stateId: "STATE_UUID"          # Triage state UUID
    }
  ) {
    success
    issue {
      id
      identifier
      url
    }
  }
}
```

Issues are always linked to a single team. The `id` is a UUID; the `identifier` is the human-readable form like `ENG-123`.

### 1.3 Webhooks

- Created via UI in Settings > Administration > API, or programmatically with `webhookCreate` mutation.
- Resource types: `Issue`, `Comment`, `IssueAttachment`, `Document`, `Reaction`, `Project`, `ProjectUpdate`, `Cycle`, `IssueLabel`.
- Can be scoped to a single team or all public teams (`allPublicTeams: true`).
- HTTP POST with JSON body matching the resource's GraphQL shape.
- Headers Linear sends:
  - `Linear-Delivery: <UUID>`
  - `Linear-Event: Issue` (or other resource type)
  - `Linear-Signature: <HMAC-SHA256>`
- Signature is HMAC-SHA256 of the raw body, using the webhook signing secret. Always verify before processing.
- Only workspace admins or OAuth apps with admin scope can create webhooks.

### 1.4 Linear's Native Triage Capabilities (As of Q1 2026)

These exist and we should NOT rebuild them. The intake portal sits in front of these and uses them.

- **Linear Asks:** branded web forms, email intake, Slack intake, with two-way comment sync. Available on Business and Enterprise plans. Can require sign-in via the customer's identity provider, or accept anonymous submissions.
- **Triage Intelligence:** LLM analyzes new triage issues against the workspace's historical issues to suggest assignee, labels, related issues, and likely duplicates. Available on Business+. Processing typically takes 1 to 4 minutes per new issue (Linear deliberately spends more time for better suggestions). Suggestions appear alongside the issue and include reasoning. Linear does NOT use customer data to train its models; data goes only to designated AI subprocessors.
- **Linear Agent:** scriptable triage automations and free-form agent actions on triage issues. Can be triggered automatically on issues entering triage. Business+.
- **Customer Requests:** first-class linkage between customer feedback and engineering work. Salesforce/Attio integration for routing rules.
- **Triage Rules:** predefined actions when conditions are met. Update team, status, assignee, label, project, priority.

### 1.5 Implications for Our Design

Because Linear has shipped these features in the last 12 months, our portal owns:

- The branded customer experience (Linear Asks shows Linear's UI, not Airiam's)
- The API surface for partner/programmatic intake (customers' monitoring tools shouldn't need Linear credentials)
- Pre-Linear AI enrichment using Airiam customer-side context (tier, SLA, deploys, open P1s) Linear cannot see
- Compliance and audit posture controlled by Airiam (RAIVS hash chain, Presidio, residency)
- Auth tied to Airiam's customer identity store, not Linear

Linear keeps:

- Cross-issue similarity / duplicate detection (Triage Intelligence does this well)
- Engineer-facing UI (no internal triage UI in our v1)
- Project/cycle/sprint management
- Comment sync to Slack/email for staff

---

## 2. ITIL 4 Classification and Priority

### 2.1 The Four Top-Level Work Types

Getting these right at intake is the single highest-leverage decision in the system because every downstream SLA, queue, and escalation path is keyed on the type.

| Type | Definition | Airiam Mapping |
|------|-----------|----------------|
| **Incident** | Unplanned interruption to a service or reduction in quality of a service. Goal: rapid restoration. | Production bug, outage, performance degradation in apps Airiam built or supports |
| **Service Request** | Planned, expected user request for access, info, or standard config. | Password reset, access grant, "how do I…" question, configuration change |
| **Problem** | Cause (or potential cause) of one or more incidents. Goal: root-cause elimination. | Pattern of recurring incidents, derived in Linear post-triage (not from intake) |
| **Change Request** | Request to add, modify, or remove anything that could affect services. | New feature request, scope addition, integration request |

### 2.2 Priority = f(Impact, Urgency)

The standard ITIL formulation, validated in ISO/IEC 20000 §8.1, is that priority should be a product of the Impact/Urgency matrix.

- **Impact:** breadth + severity of the disruption (number of users, services, sites; full outage vs. degraded vs. workaround).
- **Urgency:** time-sensitivity from the customer's perspective (or from the service's standpoint, often defined in the SLA).

A common 3x3 matrix:

| Impact \ Urgency | Low | Medium | High |
|-------------------|-----|--------|------|
| **High** | P3 | P2 | P1 |
| **Medium** | P4 | P3 | P2 |
| **Low** | P5 | P4 | P3 |

Our v1 uses a 4x4 (low/medium/high/critical on each axis) but the principle is the same.

### 2.3 The CTI Anti-Pattern

ITIL guidance is explicit that CTI (Category-Type-Item) classification taxonomies built around organizational structure are an anti-pattern. They presume root-cause knowledge at intake, look like an IT org chart rather than a definition of required support, and pre-route in ways that often miss the mark. ITIL's purpose-driven taxonomy (the four types above) is preferred.

### 2.4 ITIL Distinguishes Incidents and Service Requests Clearly

> "Incidents are unplanned interruptions to a service. Service Requests are customer or user requests that do not represent a service disruption, such as a password reset."

Our AI triage must distinguish "my X is broken" (incident) from "I'd like X to also do Y" (change request) from "please reset my password" (service request). These have radically different SLAs and routing.

---

## 3. AI Triage Best Practices

### 3.1 Patterns That Converge Across Recent Research

- **Structured output beats free-text every time.** Pydantic-validated schemas with `Literal` enums reduce hallucination dramatically and give us something writable to a database without parsing.
- **Chain-of-thought as a model field, not a separate call.** Including `rationale: str` in the output schema gives us audit-trail-quality reasoning at no extra cost.
- **Union types for "I don't know."** Realm.Security's pattern of letting the model return either `ConfidentTriage` or `InsufficientContext` rather than forcing it to guess produces much better real-world behavior. We adopt this directly.
- **Two-stage classification.** A fast cheap model (classification + spam filter) followed by a slower more capable model (full triage with context) is the dominant production pattern.
- **Local validation as cheap insurance.** A deterministic post-processor that checks the model's priority calculation against the impact/urgency matrix catches the most common LLM error (priority inflation).
- **Confidence-gated automation.** Only automate actions the model is confident about. Route uncertain tickets to humans with the model's analysis attached as a starting point, not a decision.

### 3.2 Reference Schema (Adopted)

```python
from typing import Literal, Annotated
from pydantic import BaseModel, Field

class ConfidentTriage(BaseModel):
    """Returned when the model has enough context to triage with high confidence."""
    rationale: str
    ticket_type: Literal["incident", "service_request", "feature_request", "question"]
    urgency: Literal["low", "medium", "high", "critical"]
    impact: Literal["low", "medium", "high", "critical"]
    suggested_team: str
    suggested_labels: list[str] = Field(default_factory=list, max_length=5)
    confidence: Annotated[float, Field(ge=0.0, le=1.0)]
    pii_flagged: bool = False

class InsufficientContext(BaseModel):
    """Returned when the model needs more information to triage."""
    rationale: str
    missing_information: list[str]
    confidence: Annotated[float, Field(ge=0.0, le=1.0)]

TriageResult = ConfidentTriage | InsufficientContext
```

Priority is not in the schema; it's computed deterministically from the impact/urgency matrix in code after the LLM call.

### 3.3 Empirical Findings From the Triage Literature

- GPT-4 / GPT-4o is the most capable model evaluated for security alert triage; Llama 3 and Mistral are competitive but trail.
- Local LLM SOC triage research shows ~78% automation rate on alert classification with Llama 3.1 8B, against 80-90% in published benchmarks for cloud models. Useful confidence baseline.
- Benchmark of 71% accuracy / 0.71 macro F1 on multilingual ticket classification with sentence embeddings + XGBoost; this is the floor a well-tuned system should clear easily with modern LLMs.
- Production case studies report 95% triage-time reduction when unifying structured customer metadata (tier, usage) with unstructured ticket text in a single semantic pipeline.

---

## 4. Open-Source Projects: Use, Reference, or Skip

### 4.1 Direct Dependencies (Use Now)

| Package | License | Purpose |
|---------|---------|---------|
| `pydantic-ai` | MIT | Triage agent framework. Author: Pydantic team. Already in use on Financial Operations Platform. |
| `fastapi-azure-auth` (Intility) | MIT | Entra ID / B2C JWT validation, multi-tenant issuer fetching. Has documented patterns for whitelisting tenants via `IssuerFetcher` class with cached tenant ID to issuer URL mapping. |
| `gql` + `httpx` | MIT / BSD | GraphQL client and async HTTP for Python. Use for Linear API calls. |
| `microsoft-presidio` | MIT | PII detection and redaction. Already in AIP stack. |
| `azure-messaging-webpubsubservice` | MIT | Web PubSub server SDK; issues client tokens, broadcasts to groups. |
| `azure-servicebus` | MIT | Service Bus topics/subscriptions; AIP standard. |
| `slowapi` | MIT | Rate limiting per route, per principal, per IP for FastAPI. |
| `alembic` | MIT | Schema migrations. |
| `sqlmodel` | MIT | Pydantic-aligned ORM; AIP standard. |
| `structlog` + `logfire` | Apache 2 / MIT | Structured logging + OTel observability. |
| `opentelemetry-instrumentation-fastapi` | Apache 2 | Drop-in OTel for FastAPI. |
| `@linear/sdk` (TypeScript) | MIT | Official Linear SDK; ~1.2M weekly downloads; published by Linear; code-generated from schema. Use on the Next.js side. |
| `@azure/web-pubsub-client` | MIT | Official Web PubSub JS client; handles reconnection, group join, token refresh. |
| `@azure/msal-browser`, `@azure/msal-react` | MIT | Customer Portal Account login flow on the React side. |
| `preact` | MIT | ~4.5kB React-compatible runtime; basis for the embedded widget. |
| `html-to-image` | MIT | Optional screenshot capture for the embedded widget. |
| `deepeval` | Apache 2 | Pytest-style LLM unit testing. 50+ metrics, G-Eval, RAG-specific metrics. CI-friendly. |
| `promptfoo` | MIT | YAML-driven prompt and model comparison. ~6k stars. Used by OpenAI and Anthropic per their own README. |

### 4.2 Reference Architectures (Mirror, Don't Fork)

| Project | License | Why Mirror Only |
|---------|---------|-----------------|
| `tiangolo/full-stack-fastapi-template` | MIT | We mirror the project layout, dependency injection, migration scaffolding, Docker structure, GitHub Actions CI; we don't take their auth or frontend (we have our own). |
| `iam-abbas/FastAPI-Production-Boilerplate` | MIT | We mirror their access-control decorator pattern that enforces per-route scopes against a Principal object. |
| **Sentry's User Feedback Widget** | BSL 1.1 | Source-available but commercially restricted, so no vendoring. We mirror the architecture: Preact + Shadow DOM + auto-inject or attach-to-button + lazy-loaded form + screenshot via html-to-image. |

### 4.3 Reference Only (Worth Reading, Not Vendoring)

| Project | Why |
|---------|-----|
| `vstorm-co/full-stack-ai-agent-template` | Modern FastAPI + Next.js + Pydantic AI scaffolding; useful as a sanity check. |
| `vigneshjd/camel-support--ticket-triage-agent` | Apache Camel + Java triage system; their JSON output schema for triage results is well-designed and we mirror the shape conceptually. |
| GitHub Security Lab Taskflow Agent | Internal LLM-based triage of CodeQL alerts; useful for v3 thinking about templated prompts iterated across many tickets. |
| `realm-security/agent-union-type` | Source of the union-type uncertainty pattern we adopted in ADR-002. |

### 4.4 Do Not Use

| Project / Approach | Reason |
|---------------------|--------|
| **Plane** (`makeplane/plane`) | AGPL-3.0 forces source disclosure of any derivative we host; incompatible with our SaaS posture; we're committed to Linear anyway. |
| **Open Ticket AI** | Likely AGPL; designed as a multi-system orchestrator we don't need. |
| **Self-hosting Chatwoot or Zammad** | Massive footprint for the small slice of functionality we'd actually use. |
| **OSS hash-chain libraries** (Attest, Chronicle, python-hash-chain-logging-system, hashchain) | Several decent OSS implementations exist but RAIVS is patent-pending and already in production in OSCAR. Switching loses IP value for zero functional benefit. |
| **Third-party Linear Python SDKs** (`linear-sdk`, `linear-python`) | Both partial, neither maintained by Linear; Linear's own guidance is to call GraphQL directly if not in TypeScript. |
| **LangChain / LangGraph** | Pydantic AI is a tighter, more typed framework that aligns with the rest of our stack. |
| **CrewAI / AutoGen** | Multi-agent orchestration frameworks; we don't have a multi-agent problem yet. v3 might revisit. |
| **LlamaIndex** | Useful for heavy RAG infrastructure; for v2's single-corpus pgvector retrieval we don't need it. |
| **Vendor SaaS for AI eval** (Galileo, Patronus, LangSmith) | DeepEval and Promptfoo are free, run in our own pipeline, produce equivalent outputs. |

---

## 5. Sentry User Feedback Widget Architecture (Reference for Our Embedded Widget)

This is the highest-leverage open-source insight for sprint 4.

### 5.1 Architecture Decisions Sentry Made

- **Preact, not React.** Preact is ~4.5kB, React is ~45kB. Preact closely resembles React, which Sentry's team was already familiar with, and the smaller bundle matters when the widget runs inside other people's apps. They evaluated Preact vs Svelte; Preact won on familiarity and ecosystem fit, despite Svelte producing a slightly smaller initial bundle.
- **Shadow DOM for CSS isolation.** The widget's styles cannot conflict with the host app. Non-negotiable for a drop-in widget.
- **Two distribution modes.** Auto-injected floating button (one line of code in the host) OR `attachTo(button)` for hosts that want to control placement. Both supported by the same widget.
- **Lazy-load the form.** The button itself is small; the form code only loads when the user clicks. Significantly cheaper bundle impact on the host.
- **Screenshot via lightweight library** (Sentry uses their own approach; we use `html-to-image`). Optional; widget works without it.
- **Configuration over code.** All copy, theming, required fields, submission endpoint configurable via init options.

### 5.2 Sentry's Public APIs (Pattern Reference)

```javascript
// Auto-injected floating button:
Sentry.init({
  integrations: [Sentry.feedbackIntegration({ /* options */ })]
});

// Or manual attach:
Sentry.init({
  integrations: [Sentry.feedbackIntegration({ autoInject: false })]
});
const feedback = Sentry.getFeedback();
const widget = feedback?.createWidget();
widget.appendToDom();
widget.open();

// Or fully programmatic:
const form = await feedback.createForm();
form.appendToDom();
form.open();

// Or use your own UI and just call the capture function:
Sentry.captureFeedback({
  name: "Jane Doe",
  email: "jane@example.com",
  message: "User-supplied feedback text"
});
```

### 5.3 What We Adopt for Our Widget

```javascript
// In any Airiam-built app:
import { initAiriamIntake } from '@airiam/intake-widget';

initAiriamIntake({
  apiEndpoint: 'https://intake.airiam.com/v1/tickets',
  appId: 'bdt-platform',
  apiKey: process.env.NEXT_PUBLIC_INTAKE_PUBLIC_KEY,
  user: { id: currentUser.id, email: currentUser.email },
  context: () => ({ currentRoute: window.location.pathname, version: APP_VERSION }),
  onSubmitted: (ticketId) => { /* optional callback */ },
});
```

### 5.4 The HMAC Question for Browser Code

We can't ship the HMAC secret to the browser. The pattern:

1. The host app exposes a small server-side proxy endpoint (e.g., `/api/intake-proxy`) that adds the HMAC signature using a server-side secret.
2. The widget calls the host's proxy; the proxy calls our `/v1/tickets` with HMAC.
3. The user's identity and `app_context` ride along; the host's proxy treats them as trusted because they came from the host's authenticated session.

Each Airiam app already has a backend; this is a 30-line proxy route per app.

---

## 6. Azure Web PubSub vs SignalR (Decision Reference)

We chose **Azure Web PubSub**. Microsoft's own decision guidance:

| Use SignalR Service when… | Use Web PubSub when… |
|----------------------------|------------------------|
| Already using ASP.NET / ASP.NET Core SignalR | Building real-time WebSocket apps generically |
| Primarily a .NET shop or integrating with Blazor | Want pub/sub over WebSocket |
| SignalR client available for your platform | Building your own subprotocol or using existing ones (MQTT-over-WebSocket, AMQP-over-WebSocket) |
| Want hub-style RPC semantics | Want flexibility on the WebSocket library used |

We're TypeScript-on-the-client / Python-on-the-server, so SignalR's value (the hub abstraction, the .NET ecosystem fit, the SignalR client library) does not apply to us. Web PubSub gives us:

- Pure WebSocket plus pub/sub semantics with native group-and-user model (perfect for "push status to user X")
- Native JWT auth (no separate negotiate endpoint)
- Cleaner client (`@azure/web-pubsub-client` or raw `WebSocket` API)
- Better cost shape for sparse intermittent traffic
- Subprotocol flexibility (`json.webpubsub.azure.v1` for v2 two-way; MQTT for IoT-adjacent integrations later)

**v1 use:** server-to-client status notifications only (ticket received, triage complete, Linear status change). No client-to-server messaging over Web PubSub in v1.

---

## 7. Azure Monitor Common Alert Schema (For Monitoring Adapter)

Azure Monitor publishes a standardized webhook payload format called the Common Alert Schema, available since 2018 and now the recommended format for all Azure alerts.

### 7.1 Structure

The payload has two top-level sections:

- **Essentials:** standardized fields used by all alert types. Includes `alertId`, `alertRule`, `severity` (Sev0 through Sev4), `signalType`, `monitorCondition` (Fired / Resolved), `monitoringService`, `firedDateTime`, `resolvedDateTime`, `description`, and `essentialsVersion`.
- **AlertContext:** alert-type-specific fields. Differs for metric alerts, log search alerts, activity log alerts.

Custom properties from the action group can be added to enrich routing.

### 7.2 Enabling

Per action group in the Azure portal: open the webhook action and select "Yes" to enable common alert schema. Or via REST API: set `useCommonAlertSchema: true` in the action group create/update call.

### 7.3 Limits and Caveats

- 256 KB upper size limit per alert.
- Log search alerts: if the search results would push the payload over 256 KB, results are not embedded; use `LinkToFilteredSearchResultsAPI` to fetch them via the Log Analytics API.
- Custom JSON payloads cannot be combined with the common alert schema (the schema overwrites any custom configuration).

### 7.4 Severity Mapping

Azure severity (Sev0-Sev4) maps to our urgency dimension as follows in our adapter:

| Azure Severity | Our Urgency |
|-----------------|---------------|
| Sev0 (Critical) | critical |
| Sev1 (Error) | high |
| Sev2 (Warning) | medium |
| Sev3 (Informational) | low |
| Sev4 (Verbose) | low |

The AI then adjusts based on customer-context (a Sev0 alert on a Tier-3 customer with no active SLA may merit P2 rather than P1).

---

## 8. Sentry Webhook Format (For Monitoring Adapter)

Sentry sends webhooks for issue events. Key fields for our adapter:

- `action`: `created`, `resolved`, `ignored`, etc.
- `data.issue`: includes `title`, `culprit`, `level` (debug, info, warning, error, fatal), `status`, `project`, `metadata`.
- `data.event`: the underlying error event with stack trace, breadcrumbs, tags, user info.

For our adapter, `level` maps to urgency:

| Sentry Level | Our Urgency |
|---------------|---------------|
| `fatal` | critical |
| `error` | high |
| `warning` | medium |
| `info`, `debug` | low |

---

## 9. N-able Webhook Notes (For Monitoring Adapter)

N-able (formerly SolarWinds MSP) publishes alerts via webhook with a documented payload. We support N-able primarily on the Airiam tenant since it's our MSP-side managed-services monitoring. The exact payload format is product-version-specific (N-central, N-sight RMM, etc.) and the adapter should be implemented against the specific N-able product Airiam uses in production. Build the adapter alongside an actual production N-able alert sample rather than from documentation alone.

---

## 10. SOC2 Posture (No PHI, No CUI)

### 10.1 Trust Service Criteria We Address

| Criterion | Our Implementation |
|-----------|---------------------|
| **CC6.1 Logical access** | Customer Portal Accounts via Entra External ID; RBAC with least-privilege scopes; per-API-key scopes; no shared accounts |
| **CC6.6 Encryption in transit** | TLS 1.2+ enforced; mTLS available for sensitive monitoring; Web PubSub uses WSS; Linear API is HTTPS |
| **CC6.7 Encryption at rest** | Neon Postgres default encryption; Key Vault holds secrets; CMK configurable per tenant |
| **CC7.1 Detection of security events** | OTel + App Insights of all auth failures, authorization denials, signature verification failures |
| **CC7.2 Monitoring** | Logfire for AI triage performance; App Insights for API latency/errors; per-tenant dashboards |
| **CC8.1 Change management** | All deploys via `azd` from main; PR reviews required; preview environments; ADRs locked before code |
| **CC9.2 Vendor risk** | Subprocessor list maintained; data-flow map maintained; vendor security reviews on file |

### 10.2 Subprocessor List (Draft for Audit)

| Subprocessor | Role | Data Seen |
|--------------|------|-----------|
| Microsoft Azure | Hosting (compute, storage, network, Key Vault, Service Bus, Web PubSub, App Insights) | All ticket data, audit logs |
| Azure OpenAI | LLM inference (GPT-4o) | Redacted ticket text + customer context; never raw PII; ZDR configured |
| Google Vertex AI | LLM inference (Gemini Flash) | Redacted ticket text only |
| Neon (Azure-hosted) | Postgres + pgvector | All ticket data |
| Linear | Issue tracking | All triaged tickets pushed to Linear |
| Microsoft Entra External ID | Customer Portal identity | User profile data only |
| Email provider (Azure Communication Services or SendGrid) | Transactional email | Ticket subject lines, statuses, links; no full ticket bodies |

### 10.3 Audit Trail

Two layers:

- **Layer 1: WORM event chain (RAIVS-style).** Hash-chained events per ticket. Patent-pending pattern from OSCAR. Captured events: `ticket.received`, `ticket.triaged`, `ticket.pushed_to_linear`, `ticket.linear_status_changed`, `ticket.notification_sent`, `ticket.failed`.
- **Layer 2: access log.** Every API call (success or failure) writes to an append-only table with caller identity, IP, request signature, response code, scrubbed bodies.

Both layers replicate to Azure Storage with immutable blob policy. 7-year retention by default, configurable per tenant.

---

## 11. Auth Strategy Reference

### 11.1 Three Principal Types

```python
class Principal(BaseModel):
    kind: Literal["end_user_portal", "end_user_via_app", "service"]
    customer_id: UUID
    auth_method: Literal["jwt", "hmac", "oauth_cc", "mtls"]
    scopes: list[str]
    user_id: str | None = None
    user_email: str | None = None
    app_id: str | None = None  # for end_user_via_app
    service_id: str | None = None  # for service callers
    service_kind: str | None = None  # 'monitoring', 'integration', 'admin'
```

### 11.2 Auth Method Matrix

| Method | Used By | Why |
|--------|---------|-----|
| **JWT bearer** | Customer Portal users | Standard for browser sessions; works with Web PubSub |
| **HMAC-signed requests** | Embedded customer apps; direct API access | No round trip to auth server; key never on the wire; replay-safe |
| **OAuth 2.0 client credentials** | Modern monitoring tools (Azure Monitor, Sentry, N-able) | Standard service-to-service among tools that speak OAuth |
| **mTLS** | Highest-sensitivity monitoring callers | Certificate-bound; cannot be replayed, leaked, or phished |

### 11.3 Resolution Order

JWT to HMAC to OAuth client credentials to mTLS. First strategy that validates wins. If all fail, return 401 with `WWW-Authenticate: Bearer, HMAC realm="airiam-intake", mTLS`.

---

## 12. Two-Tenant Deployment Model

Same code, two Azure deployments, no shared data plane.

```python
class TenantConfig(BaseModel):
    tenant_slug: Literal["airiam", "canopy"]
    tenant_display_name: str
    portal_url: str
    api_url: str
    linear_workspace_id: str
    linear_default_team_mapping: dict[str, str]
    linear_api_key_secret_ref: str
    entra_tenant_id: str
    entra_audience: str
    entra_signing_keys_url: str
    brand_primary_color: str
    brand_logo_url: str
    brand_email_from: str
    require_mfa_for_admins: bool = True
    pii_detection_strict_mode: bool = True
    audit_retention_days: int = 2555  # 7 years
```

Bicep parameter files per environment: `airiam.dev.bicepparam`, `airiam.prod.bicepparam`, `canopy.dev.bicepparam`, `canopy.prod.bicepparam`.

Deployment: `azd up --environment airiam-prod` deploys the Airiam production tenant; analogous for Canopy.

**Critical rule:** the Canopy deployment never displays the word "Airiam" anywhere customer-facing.

---

## 13. Cost Model (Order of Magnitude)

Per-ticket cost at 1,000 tickets/month per tenant:

| Component | Per-ticket Cost |
|-----------|-----------------|
| Gemini Flash (fast filter) | ~$0.0002 |
| GPT-4o (full triage) | ~$0.012 |
| Presidio (self-hosted) | ~$0.00005 |
| Linear API | $0 (within free quota) |
| Postgres + pgvector | ~$0.0001 |
| Azure infra (per tenant, fixed) | ~$200/mo amortized |
| **AI cost per ticket** | **~$0.012** |
| **All-in per ticket at 1,000/mo** | **~$0.21** |

At 10,000 tickets/month per tenant, all-in drops to ~$0.03 per ticket. GPT-4o-mini variant of the triage agent would drop the LLM cost by ~6x at some accuracy cost; held in reserve as a tuning lever once we have eval data.

---

## 14. v1.1 Sprint Plan (Locked)

| Sprint | Duration | Owner(s) | Deliverables |
|--------|----------|----------|--------------|
| 0 | 1 wk | Greg | This doc reviewed; ADRs locked with Kuk Yi; Linear OAuth apps registered for both tenants; Entra External ID directories provisioned; Azure subs/RGs created; secrets seeded |
| 1 | 1.5 wks | Daniel + Pedro | API skeleton with auth resolver and all four strategies; Customer Portal Accounts via Entra External ID; DB schema + migrations; Web PubSub provisioned; Bicep modules + per-tenant parameter files |
| 2 | 1.5 wks | Daniel | Triage worker + Pydantic AI agent; Presidio inline; fast filter; full triage; priority calc; Linear push happy path; the three v1 monitoring adapters (N-able, App Insights, Sentry) |
| 3 | 1 wk | Daniel + Pedro | Linear webhook listener with signature verification; status-change events; email + Web PubSub fanout; customer status page in the portal |
| 4 | 0.5 wk | Pedro | Embedded widget reference implementation (Preact + Shadow DOM, Sentry pattern); embedded auth; documentation |
| 5 | 0.5 wk | Greg + Daniel | Eval set (50-100 historical tickets); accuracy measurement; threshold tuning; Logfire + App Insights dashboards; SOC2 audit-readiness checklist |
| 6 | 1 wk | All | Beta launch into Airiam tenant; Canopy tenant deployment dry run |

Acceptance gates: triage accuracy ≥ 85% on the eval set; audit chain integrity verified in load test; no critical findings in security review; two-tenant deployment works without code change.

---

## 15. Greg's Decided Items (Reference)

Locked from v1.1 follow-up review:

- Stack: AIP sibling service, Web PubSub over SignalR, Azure-hosted.
- Customer auth: Customer Portal Account via Entra External ID.
- API callers: customer-app embedded "Open a Ticket" button + monitoring + direct API. Auth must be flexible (multi-strategy resolver as designed).
- Business impact: both customer-supplied and Airiam-internal context, with internal context improving over time.
- Compliance: SOC2 for both Airiam and Canopy tenants. No PHI, no CUI in v1. Same code, two deployments.
- Sync: one-way in v1 (status flows to customer; comments do not sync). Two-way is v2.
- Beta customer list: not yet identified; building speculatively.
- Canopy tenant: deploys in parallel with Airiam beta, likely shadow mode initially.
- SSO/federation: v1.1, not v1.
- Embedded widget rollout: AR/AP and FinOps around the same time as BDT, possibly before BDT.
- Customer registry: AIP `customers` table is the confirmed source of truth.
- Patent angle: parked for future conversation.

---

*End of research findings reference.*