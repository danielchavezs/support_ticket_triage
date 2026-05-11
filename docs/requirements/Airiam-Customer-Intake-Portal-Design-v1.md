# Airiam Customer Intake Portal: Design & Best-Practice Analysis

**Document type:** Architecture & Design Proposal (pre-TDD)
**Version:** 1.0 (Draft)
**Prepared by:** Greg Williams / Airiam Advanced Technologies
**Audience:** Internal architecture review (Kuk Yi, Daniel Chávez, Pedro Aquino)
**Status:** Draft for review

---

## 1. Executive Summary

We are designing a customer-facing intake portal that accepts tickets via two surfaces (a branded web UI and a RESTful API), runs each submission through an AI triage pipeline, enriches it with Airiam-side business context, and pushes the result into Airiam's single Linear workspace where development work is tracked.

After deep analysis of ITIL 4 practice guidance, open-source prior art (Plane, Open Ticket AI, Pydantic AI, Linear's own platform), and recent academic work on LLM-based triage, the recommendation is to **build a thin, opinionated portal on the existing Airiam Intelligence Platform (AIP) stack** that sits *in front of* Linear's native Triage features, not as a replacement for them. This is the highest-leverage cut: we own the customer experience, the AI pre-classification (using Airiam-specific context Linear cannot see), and the API surface; Linear continues to own the developer-facing work tracking and inherits its native AI capabilities for free.

The recommended v1 AI triage cut classifies each ticket along five dimensions (type, urgency, impact, priority, suggested team) using a structured-output Pydantic AI agent with confidence-gated fallback to human triage. The v2/v3 roadmap layers in similar-ticket detection, draft customer replies, and runbook-grounded resolution proposals as the corpus of historical tickets grows.

A critical architectural decision flagged below: Linear has shipped substantial native intake and AI features in the last 12 months (Linear Asks, Triage Intelligence, Linear Agent). The design deliberately avoids duplicating those capabilities and instead leverages them through Linear's GraphQL API and webhooks.

---

## 2. Best-Practice Findings

### 2.1 ITIL 4: The Classification Taxonomy That Matters

ITIL 4 draws hard lines between four top-level work types. Getting these right at intake is the single highest-leverage decision in the system because every downstream SLA, queue, and escalation path is keyed on the type.

| Type | ITIL 4 Definition (paraphrased) | Airiam Mapping |
|------|----------------------------------|----------------|
| **Incident** | Unplanned interruption to a service or reduction in quality. Goal is rapid restoration. | Production bug, outage, performance degradation in apps Airiam built or supports |
| **Service Request** | Planned, expected user request (access, info, standard config). | Password reset, access grant, "how do I…" question, configuration change |
| **Problem** | Cause (or potential cause) of one or more incidents. Goal is root-cause elimination. | Pattern of recurring incidents, derived in Linear post-triage (not from intake) |
| **Change Request** | Request to add, modify, or remove anything that could affect services. | New feature request, scope addition, integration request |

**Why this matters for our AI:** the model must distinguish "my X is broken" (incident) from "I'd like X to also do Y" (change request) from "please reset my password" (service request). These have radically different SLAs and routing. ITIL guidance is explicit that classification taxonomies built around organizational structure (CTI: Category-Type-Item) are an anti-pattern because they presume root-cause knowledge at intake. We follow ITIL's purpose-driven taxonomy instead.

### 2.2 Priority = f(Impact, Urgency)

The standard ITIL formulation, validated in ISO/IEC 20000 §8.1, is that priority should be a product of the Impact/Urgency matrix. Urgency reflects how time-sensitive resolution is from the customer's perspective; impact reflects the breadth and severity of the disruption.

Rather than asking customers to pick "P1" directly (which they will always do), we collect impact and urgency as separate signals (one optional from the user, one inferred by the AI from text + Airiam context) and compute priority deterministically via a published 3×3 matrix. This is more defensible, more consistent, and produces priorities the customer can trust because the rule is transparent.

### 2.3 What "Business Impact" Should Actually Encode

Best-practice intake forms collect impact along three axes:

1. **Breadth**: number of users / sites / services affected
2. **Severity**: full outage, degraded, workaround available, cosmetic
3. **Business consequence**: revenue, compliance, reputation, internal productivity

Customer-supplied impact alone is unreliable (every customer says their issue is critical). The high-leverage move is to enrich customer-supplied impact with Airiam-side context the customer cannot see: their MSP tier, active SLA, currently-open P1s for that tenant, recently-deployed changes correlated to the ticket window, and product/service criticality. This is exactly what Linear's Triage Intelligence cannot do because it has no view into Airiam's customer database.

### 2.4 Intake-Channel Best Practices (HDI / Service Desk literature)

Recurring themes across HDI guidance and the academic literature on ticket triage:

- **Make the form do the work the model can't.** Required fields for affected service, customer-perceived impact, and steps to reproduce produce far better triage than long-form unstructured text alone.
- **Show the requester they are heard immediately.** Auto-acknowledgement with a ticket reference and a realistic ETA reduces follow-up volume by 30 to 50 percent in published case studies.
- **Two-way sync is non-negotiable.** Customers should be able to reply via the channel they submitted on (web portal, email, API webhook). Forcing them into a separate tool is the #1 cause of duplicate tickets.
- **Confidence-gated automation.** Only automate the actions the model is confident about; route uncertain tickets to humans with the model's analysis attached as starting point, not a decision.

### 2.5 Lessons From the AI Triage Research

Recent open-source and published work converges on a few patterns worth adopting:

- **Structured output beats free-text every time.** Pydantic-validated schemas with `Literal` enums reduce hallucination dramatically and give us something we can write to a database without parsing.
- **Chain-of-thought as a model field, not a separate call.** Including `rationale: str` in the output schema gives us audit-trail-quality reasoning at no extra cost and helps debugging.
- **Union types for "I don't know."** Realm.Security's pattern of letting the model return either `ConfidentTriage` or `InsufficientContext` rather than forcing it to guess produces much better real-world behavior than a single rigid schema. We adopt this directly.
- **Two-stage classification.** A fast cheap model (classification + spam filter) followed by a slower more capable model (full triage with context) is the dominant production pattern. Mirrors the BDT Platform's existing Gemini Flash + GPT-4o split.
- **Local validation is cheap insurance.** A deterministic post-processor that checks the model's priority calculation against the impact/urgency matrix catches the most common LLM error (priority inflation).

---

## 3. Open-Source Code Landscape: What to Leverage

Findings from a focused scan of GitHub, PyPI, and the ITSM tooling ecosystem, organized by what we should actually use versus what is reference-only.

### 3.1 Use Directly (License-Compatible)

| Project | License | Role in Our Stack | Notes |
|---------|---------|-------------------|-------|
| **Pydantic AI** (pydantic/pydantic-ai) | MIT | Triage agent framework | Model-agnostic, structured outputs via Pydantic schemas, OTel observability built in. Already in use on Financial Operations Platform. Drop-in. |
| **Linear TypeScript SDK** (@linear/sdk) | MIT | Linear API client | Strongly typed, mirrors the GraphQL schema. Use from the Next.js side and from a Python service via direct GraphQL where Python is preferred. |
| **gql + httpx** (Python) | MIT / BSD | Python-side Linear client | We do not need a Linear Python SDK; the GraphQL endpoint is small enough that `gql` against `https://api.linear.app/graphql` is cleaner. |
| **Microsoft Presidio** | MIT | PII redaction before LLM call | Already in the AIP stack. Required for any tickets that may contain PHI, PII, or CUI. |
| **FastAPI + SQLModel** | MIT | Backend framework | Matches AIP standard. SQLModel keeps Pydantic models and DB models unified. |
| **Next.js 15** | MIT | Customer-facing web portal | AIP standard. Server components for the form, client components for the interactive submission flow. |
| **fastapi-azure-auth** (intility) | MIT | Multi-tenant Entra ID JWT validation | Issuer-validation pattern for accepting only known Airiam customer tenants. |
| **Azure Service Bus SDK** | MIT | Async event fanout | AIP standard for the `ticket.submitted` and `ticket.triaged` topics. |
| **Stripe** | Apache 2 client SDKs | Optional: usage-based billing if we ever productize | Already in the AIP stack; not needed for v1. |

### 3.2 Reference Only: Do Not Vendor

| Project | License | Why Not | What We Take From It |
|---------|---------|---------|-----------------------|
| **Plane** (makeplane/plane) | AGPL-3.0 | AGPL forces source disclosure of any derivative we host. Incompatible with proprietary SaaS. | Their triage inbox UX is a useful reference for the staff-side triage view. We design our own. |
| **Open Ticket AI** | Likely AGPL (verify before use) | Same disclosure concern; designed as a multi-system orchestrator we do not need. | Their `UnifiedTicket` model is a useful conceptual anchor for our portal-internal schema. |
| **Chatwoot** | MIT (core) but heavy footprint | Way too much surface area for our use case (full live-chat platform). | Their AI auto-response patterns are worth studying for v2 draft-reply work. |
| **camel-support--ticket-triage-agent** | Apache 2.0 | Apache Camel + Java; we are Python/TypeScript. | Their JSON output schema for triage results is a good reference; we'll mirror the shape. |
| **trIAge** (latentspace-lab) | Reference | Built for OSS issue triage on GitHub, not customer support. | Demonstrates the value of repository-aware context; we apply the same idea to Airiam's customer context. |
| **PascalNB/llm-triage-automation** | Reference | Security alert triage research. | Empirical comparison of GPT-4 vs Llama 3 vs Mistral for triage; informs our model choice. |

### 3.3 Linear's Native Capabilities: Do Not Rebuild

This is the single most important finding from the research. In the last 12 months Linear has shipped:

- **Linear Asks**: branded web forms, email intake, Slack intake, with two-way comment sync. Available on Business+ plans.
- **Triage Intelligence**: LLM analyzes new triage issues against historical issues to suggest assignee, labels, related issues, and likely duplicates. Business+ plans.
- **Linear Agent**: scriptable triage automations and free-form agent actions on triage issues. Business+ plans.
- **Customer Requests**: first-class linkage between customer feedback and engineering work, with Salesforce/Attio integration for triage routing rules.

**Implication for our design:** the things we build must add value Linear's native features cannot. Specifically:

- **Branded customer experience**: Linear Asks shows Linear's UI, not Airiam's
- **API surface for partner/programmatic intake**: customer monitoring tools, RMM systems, MSP customer portals push tickets via our API; they should not need Linear credentials
- **Pre-Linear AI enrichment**: using Airiam's customer DB, contracts, SLAs, deploy history, asset inventory; Linear Triage Intelligence cannot see any of this
- **Compliance and audit posture controlled by Airiam**: WORM hash-chain audit trail (RAIVS pattern), Presidio PII redaction, data residency control
- **Authentication tied to Airiam's customer identity store, not Linear**

**Things we explicitly delegate to Linear:**
- Cross-issue similarity / duplicate detection (Triage Intelligence is good at this and gets better as the corpus grows)
- Engineer-facing UI (we build no internal triage UI in v1; staff triage in Linear)
- Project/cycle/sprint management (already locked, do not touch)
- Comment sync to Slack/email for staff (Linear handles this natively)

---

## 4. Recommended AI Triage Scope

### 4.1 v1: Ship in 6 to 8 Weeks

The v1 cut classifies each submission against five fields and gates by confidence. Anything below threshold lands in a human-triage queue with the AI's analysis attached as starting point, not as decision.

```python
# triage_schemas.py
from typing import Literal, Annotated
from pydantic import BaseModel, Field
from datetime import datetime

class ConfidentTriage(BaseModel):
    """Returned when the model has enough context to triage with high confidence."""

    rationale: str = Field(
        description="Step-by-step reasoning for the classification. Used for audit trail."
    )

    ticket_type: Literal[
        "incident", "service_request", "feature_request", "question"
    ] = Field(description="ITIL-aligned classification.")

    urgency: Literal["low", "medium", "high", "critical"] = Field(
        description="Time-sensitivity from customer perspective."
    )

    impact: Literal["low", "medium", "high", "critical"] = Field(
        description="Breadth + severity of disruption. Use Airiam customer "
                    "context when available."
    )

    suggested_team: str = Field(
        description="Linear team key (e.g. 'BDT', 'AIP', 'OSCAR-RCM')."
    )

    suggested_labels: list[str] = Field(
        default_factory=list, max_length=5
    )

    confidence: Annotated[float, Field(ge=0.0, le=1.0)]

    pii_flagged: bool = Field(
        default=False,
        description="True if the redactor found PII/PHI in the source text."
    )


class InsufficientContext(BaseModel):
    """Returned when the model needs more information to triage."""

    rationale: str
    missing_information: list[str] = Field(
        description="Specific questions to ask the customer."
    )
    confidence: Annotated[float, Field(ge=0.0, le=1.0)]


TriageResult = ConfidentTriage | InsufficientContext
```

Priority is *not* an LLM output. It is computed deterministically from the impact/urgency matrix:

```python
PRIORITY_MATRIX = {
    # (impact, urgency): linear_priority
    ("critical", "critical"): 1,  # P1 / Urgent
    ("critical", "high"):     1,
    ("high", "critical"):     1,
    ("high", "high"):         2,  # P2 / High
    ("critical", "medium"):   2,
    ("medium", "critical"):   2,
    ("high", "medium"):       3,  # P3 / Medium
    ("medium", "high"):       3,
    ("medium", "medium"):     3,
    # ... matrix continues; all "low" combinations -> P4 (Low)
}
```

This makes priority auditable and policy-driven. Customers cannot game it by claiming "critical" because urgency is one input among several.

**v1 deliverables:**
- Web form with required fields (affected service, customer-perceived urgency, free-text description)
- RESTful API with HMAC-signed requests for programmatic intake
- Two-stage AI: fast spam/quality filter (Gemini Flash), then full triage (GPT-4o on Azure OpenAI)
- Deterministic priority calculation from the matrix
- Linear push with all suggested fields populated; issue lands in Triage status
- Linear webhook listener for status changes; customer notified via email and SignalR if connected to portal
- Audit log entry per ticket event (RAIVS hash chain pattern from OSCAR)
- Confidence threshold (0.7 in v1, tunable) below which issue is flagged for human triage with a `needs-human-triage` label

**Explicit non-goals for v1:**
- No similar-ticket detection (let Linear Triage Intelligence handle this)
- No draft customer replies (v2)
- No proposed resolution from runbooks (v2)
- No auto-resolve of any ticket (v3 at earliest, and only for narrow categories like password resets with proven track record)

### 4.2 v2: Ship 8 to 12 Weeks After v1

- **Similar-ticket retrieval (RAG)**: pgvector index on past ticket embeddings, surface top-3 with similarity score in the AI's input context. Not duplicate detection (Linear handles that), but historical-resolution context.
- **Draft customer acknowledgement**: generated reply that says "we received this, here's our understanding, here's our SLA-bound ETA." Approved by staff before sending in v2; auto-sent in v3 once we have proven accuracy.
- **Runbook RAG**: index Airiam's internal knowledge base (Confluence, GitHub wikis, the OSCAR/BDT/AIP TDDs); LLM proposes a starting-point resolution attached to the ticket as a Linear comment.
- **Customer satisfaction signal capture**: short survey on resolution; feeds eval set for triage accuracy.

### 4.3 v3: Future

- **Auto-resolve narrow categories**: service requests with proven >99% historical accuracy (password resets, standard access grants).
- **Cross-ticket pattern detection**: when N similar incidents arrive in window W, auto-create a Problem ticket and link the incidents.
- **Tool-using agent**: LLM with read access to monitoring (Datadog/Sentry), CMDB, deploy history. Proposes root cause hypothesis with evidence.
- **Auto-draft of internal triage notes** for high-confidence cases.

---

## 5. Reference Architecture

### 5.1 High-Level

```
┌─────────────────────────────────────────────────────────────────┐
│                    Airiam Customer Intake Portal                │
│                                                                 │
│  ┌──────────────┐         ┌─────────────────────────────────┐  │
│  │ Web Portal   │         │ RESTful API                     │  │
│  │ (Next.js 15) │         │ (FastAPI, OpenAPI 3.1)          │  │
│  │              │         │                                 │  │
│  │ • Form       │         │ • POST /v1/tickets              │  │
│  │ • Auth (Entra│         │ • GET  /v1/tickets/{id}         │  │
│  │   B2C)       │         │ • POST /v1/tickets/{id}/comment │  │
│  │ • Status view│         │ • Webhook subscriptions         │  │
│  └──────┬───────┘         └─────────────┬───────────────────┘  │
│         │                               │                       │
│         └───────────┬───────────────────┘                       │
│                     │                                           │
│              ┌──────▼─────────┐                                 │
│              │ Intake Service │                                 │
│              │  (FastAPI)     │                                 │
│              │                │                                 │
│              │ • Validation   │                                 │
│              │ • Auth (JWT/   │                                 │
│              │   HMAC)        │                                 │
│              │ • Persist      │                                 │
│              │ • Emit event   │                                 │
│              └──────┬─────────┘                                 │
│                     │                                           │
│              ┌──────▼─────────┐         ┌──────────────────┐   │
│              │ Neon Postgres  │         │ Service Bus      │   │
│              │ (pgvector)     │         │ topic:           │   │
│              │                │◄────────│ ticket.submitted │   │
│              │ • tickets      │         └────────┬─────────┘   │
│              │ • events (WORM)│                  │             │
│              │ • audit_chain  │                  ▼             │
│              └────────────────┘         ┌──────────────────┐   │
│                                          │ Triage Worker    │   │
│                                          │ (Pydantic AI)    │   │
│                                          │                  │   │
│              ┌────────────────┐          │ 1. Presidio scrub│   │
│              │ Azure OpenAI   │◄─────────│ 2. Fast filter   │   │
│              │ • GPT-4o       │          │    (Gemini Flash)│   │
│              │ Vertex AI      │◄─────────│ 3. Full triage   │   │
│              │ • Gemini Flash │          │    (GPT-4o)      │   │
│              └────────────────┘          │ 4. Priority calc │   │
│                                          │ 5. Linear push   │   │
│                                          └────────┬─────────┘   │
│                                                   │             │
│                                                   ▼             │
│                                          ┌──────────────────┐   │
│                                          │ Linear (single   │   │
│                                          │ Airiam workspace)│   │
│                                          │                  │   │
│                                          │ • Issue created  │   │
│                                          │   in Triage      │   │
│                                          │ • Webhook fires  │   │
│                                          └────────┬─────────┘   │
│                                                   │             │
│              ┌──────────────────┐                 │             │
│              │ Webhook Listener │◄────────────────┘             │
│              │ (FastAPI)        │                               │
│              │                  │                               │
│              │ • Status changes │                               │
│              │ • Comments       │──► SignalR ─► Customer portal │
│              │ • Resolution     │──► Email   ─► Customer        │
│              └──────────────────┘                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Service Topology Inside the AIP Monorepo

The portal is a **sibling service** in the AIP monorepo, sharing the same auth/audit/queue libraries. Concretely:

```
aip-platform/
├── services/
│   ├── operations-core/          # existing AIP FastAPI service
│   ├── intelligence-service/     # existing Next.js 15
│   └── customer-intake/          # NEW: this project
│       ├── api/                  # FastAPI app
│       ├── workers/              # Triage worker, webhook listener
│       ├── web/                  # Next.js 15 customer portal
│       └── infra/                # Bicep additions
├── packages/
│   ├── airiam-auth/              # shared, used here
│   ├── airiam-audit/             # shared (RAIVS hash chain)
│   ├── airiam-events/            # shared (Service Bus wrappers)
│   └── airiam-presidio/          # shared (PII redaction)
└── ...
```

Daniel owns infrastructure and the worker; Pedro owns the web portal; both cooperate on the API contract.

### 5.3 Authentication Model

Two distinct auth flows, each appropriate to its surface:

**Web portal ,  Entra External ID (B2C):**
- Customer admins onboarded by Airiam, receive Entra invitation
- Multi-tenant: customer's organization is a tenant claim in the JWT
- `fastapi-azure-auth` validates issuer against Airiam's customer registry on every request
- RBAC: `customer_admin`, `customer_user`, `customer_readonly`

**RESTful API ,  HMAC-signed API keys per customer:**
- Each customer organization issued one or more API keys (scope: `tickets:write`, `tickets:read`, `comments:write`)
- Request signed: `Authorization: HMAC-SHA256 keyId=<id>, signature=<sig>, ts=<unix>`
- Replay protection via timestamp window (5 min) + nonce in signature
- Rate-limited per key (100 req/min in v1, configurable)
- Audit log captures every API call with key ID

OAuth 2.0 client credentials is the v2 upgrade path for partners that need it (e.g., a customer's PSA/RMM tool).

### 5.4 Linear Integration Specifics

- **App registration:** create a Linear OAuth application (`Airiam Intake Portal`) at the workspace level; admin-scoped for webhook management.
- **Authentication:** use a workspace-scoped API key for the triage worker's `issueCreate` mutations. Key stored in Azure Key Vault, rotated quarterly.
- **Routing:** the AI's `suggested_team` is mapped to a Linear team via a config table (not hardcoded). New teams added without code change.
- **Issue creation mutation:**
  ```graphql
  mutation CreateIntakeIssue($input: IssueCreateInput!) {
    issueCreate(input: $input) {
      success
      issue { id identifier title url }
    }
  }
  ```
  with input fields: `teamId`, `title`, `description` (markdown body with structured customer context block), `priority` (1-4 from our matrix), `labelIds` (suggested labels + an `intake-portal` label so we can find them later), `stateId` (Triage status).
- **Webhooks:** subscribe to `Issue` and `Comment` resource types on all teams. Webhook receiver verifies `Linear-Signature` HMAC, matches issue back to our internal ticket via the `intake-portal` label and an external ID stored in the issue body, and pushes status/comment back to the customer.
- **Rate limits:** Linear allows 1,500 requests per hour per user with API key authentication, plus complexity-based limits. Our worst case at 90 customers and 100 tickets/day is well within. We still queue all writes through Service Bus to absorb spikes.

### 5.5 Data Model (Core Tables)

```sql
-- Tickets (system of record on the portal side; Linear has its own)
CREATE TABLE tickets (
  id              UUID PRIMARY KEY,
  customer_id     UUID NOT NULL REFERENCES customers(id),
  submitted_by    TEXT NOT NULL,                    -- email or API key id
  submission_channel  TEXT NOT NULL,                -- 'web' | 'api'
  raw_title       TEXT NOT NULL,
  raw_description TEXT NOT NULL,
  redacted_description TEXT,                        -- post-Presidio
  status          TEXT NOT NULL DEFAULT 'received', -- 'received' | 'triaging' | 'pushed' | 'resolved' | 'failed'
  ticket_type     TEXT,
  urgency         TEXT,
  impact          TEXT,
  priority        SMALLINT,
  ai_confidence   NUMERIC(3,2),
  ai_rationale    TEXT,
  linear_issue_id TEXT,
  linear_team_id  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Embedding for v2 RAG
ALTER TABLE tickets ADD COLUMN description_embedding VECTOR(1536);

-- Append-only event stream (WORM, hash-chained per OSCAR pattern)
CREATE TABLE ticket_events (
  id            BIGSERIAL PRIMARY KEY,
  ticket_id     UUID NOT NULL REFERENCES tickets(id),
  event_type    TEXT NOT NULL,    -- submitted | triaged | pushed_to_linear | linear_status_changed | resolved | etc.
  event_payload JSONB NOT NULL,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  prev_hash     BYTEA NOT NULL,   -- forward-secure chain
  this_hash     BYTEA NOT NULL
);

CREATE INDEX ix_tickets_customer_status ON tickets(customer_id, status);
CREATE INDEX ix_ticket_events_ticket_id ON ticket_events(ticket_id, occurred_at);
```

The audit chain mirrors the RAIVS pattern already in the OSCAR portfolio. Patent-pending mechanism, used here without reproducing the algorithm in client-visible code.

### 5.6 The Triage Pipeline (Step by Step)

When a ticket arrives:

1. **Validation & persist**: FastAPI route validates against Pydantic schema, writes `tickets` row with status `received`, writes `submitted` event.
2. **Emit**: `ticket.submitted` event published to Service Bus topic.
3. **Acknowledge**: API/web returns 202 with ticket ID. Customer sees "received" within 200ms.
4. **Triage worker picks up**: Service Bus subscription delivers to the Triage Worker.
5. **PII redaction**: Presidio scrubs description; redacted version saved.
6. **Customer context lookup**: query Airiam customer DB for tier, active SLA, currently-open P1s for this customer, recent deploys in the last 24h. This becomes part of the LLM input.
7. **Fast filter (Gemini Flash)**: spam/quality check, language detection. ~200ms. Below quality threshold → flag for human review, do not push to Linear.
8. **Full triage (GPT-4o on Azure OpenAI)**: Pydantic AI agent with the schema above. ~1 to 3s. Returns `ConfidentTriage` or `InsufficientContext`.
9. **Priority calculation**: deterministic from matrix.
10. **Confidence gate**: confidence below threshold → label `needs-human-triage`, still push to Linear but with a triage-rule that prevents auto-routing.
11. **Linear push**: `issueCreate` mutation; on success, store `linear_issue_id`, status → `pushed`, write `pushed_to_linear` event.
12. **Customer ack**: email/SignalR with ticket ID, AI-derived priority, expected SLA.

Failures at any step write a `failed` event with full context and post to a dead-letter queue. Daniel's existing AIP error-handling pattern applies.

---

## 6. Architecture Decision Records (Locked)

**ADR-INTAKE-001: Sit in front of Linear, not next to it.**
We do not duplicate Linear's Asks, Triage Intelligence, or Linear Agent. The portal owns the customer experience and pre-Linear AI enrichment using Airiam-side context; Linear remains the system of record for development work. *Consequences:* lower build cost, simpler product story, dependency on Linear's continued availability of these features (acceptable given their commercial trajectory).

**ADR-INTAKE-002: Pydantic AI with structured outputs and union-type uncertainty.**
The triage agent returns `ConfidentTriage | InsufficientContext` rather than a single rigid schema. *Consequences:* fewer hallucinations on edge cases; explicit human-handoff path; OTel spans give us auditable reasoning per ticket.

**ADR-INTAKE-003: Priority is deterministic, computed from impact and urgency.**
The LLM does not output priority directly. Priority is calculated post-LLM from the published impact/urgency matrix. *Consequences:* defensible, consistent, customer-explainable; the matrix is policy and can be tuned without retraining anything.

**ADR-INTAKE-004: Two-stage classification.**
Fast cheap model (Gemini Flash) for quality/spam, slow capable model (GPT-4o) for full triage. *Consequences:* mirrors the BDT Platform ensemble pattern Greg has validated; bounds cost; degrades gracefully if either provider is down.

**ADR-INTAKE-005: Web portal uses Entra External ID; API uses HMAC-signed keys.**
Two distinct auth surfaces optimized for their respective audiences. *Consequences:* customer admins manage human users in their Entra tenant; programmatic integrations get keys without per-user friction; OAuth 2.0 client credentials is a v2 add for advanced partners.

**ADR-INTAKE-006: Customer Intake is a sibling service in the AIP monorepo.**
Shares `airiam-auth`, `airiam-audit`, `airiam-events`, `airiam-presidio` packages with operations-core. *Consequences:* zero duplicated infrastructure; consistent observability; deploys via existing AIP `azd` pipeline.

**ADR-INTAKE-007: WORM audit trail with RAIVS hash chain.**
Every ticket event is hash-chained for forward-secure tamper detection, mirroring the OSCAR pattern. *Consequences:* compliance-ready posture from day one; HIPAA / CMMC mode is a config toggle, not a re-architecture.

**ADR-INTAKE-008: Confidence-gated automation.**
Below-threshold tickets land in Linear with a `needs-human-triage` label; the AI's analysis is attached but not authoritative. Threshold is configurable per customer tier and per ticket type. *Consequences:* fast remediation when the AI is wrong; preserves trust as the system matures; gives us labeled training signal for future eval and tuning.

---

## 7. Sprint Plan (v1: 8 Weeks)

| Sprint | Duration | Owner(s) | Deliverables |
|--------|----------|----------|--------------|
| **0** | 1 week | Greg | Architecture review, ADRs locked with Kuk Yi, Linear OAuth app registered, Entra External ID tenant configured for portal sign-in |
| **1** | 2 weeks | Daniel + Pedro | API skeleton (`POST /v1/tickets`, validation, persist, emit), DB schema and migrations, web form (Next.js) talking to API, basic auth on both sides |
| **2** | 2 weeks | Daniel | Triage worker scaffolding, Pydantic AI integration with the schemas, Presidio inline, fast filter (Gemini Flash), full triage (GPT-4o), priority calc, Linear push happy path |
| **3** | 1 week | Daniel | Linear webhook listener, two-way comment sync, customer notifications (email + SignalR for connected portal users), audit chain wired in |
| **4** | 1 week | Pedro | Customer-facing status page, ticket history view, comment reply UI, polish & accessibility pass |
| **5** | 1 week | Greg + Daniel | Eval set built from 50 historical tickets (manual labels), accuracy measurement, threshold tuning, observability dashboards in Logfire/Application Insights |

Beta with 3 friendly customers at end of week 8. Production rollout gated on accuracy ≥ 85% on the eval set and 100% audit chain integrity in load test.

---

## 8. Risks & Open Questions

**Compliance scope.** v1 ships as "general business support tickets." If we need HIPAA mode (likely for any Canopy-adjacent customer) or CMMC mode (for federal-adjacent), the data residency, BAA, and audit posture differ. We've left the audit chain and Presidio in v1 so flipping modes later is a configuration change, not a re-architecture. Decision needed: do we ship v1 in general mode and add HIPAA/CMMC modes in v1.1, or build them in from the start?

**Linear plan tier.** Triage Intelligence, Linear Agent, and Customer Requests are Business+ features. Confirm Airiam's current Linear plan covers what we plan to delegate to Linear. If not, this is a small commercial decision but a real one.

**Authoritative customer registry.** The triage worker enriches with customer tier, SLA, recent deploys. This data lives in… where? AIP customer table? A separate CRM? Decision needed before sprint 2 because it gates the enrichment step. Recommendation: AIP `customers` table is the source of truth and other systems sync to it.

**Spam and abuse.** Public-facing portals get junk. v1 has the fast-filter pass and HMAC keys for the API, but a true rate-limiting and abuse-detection layer (per IP, per email, behavioral) is not in v1 scope. Acceptable for closed-beta with known customers; needs hardening before we accept self-signup.

**Eval cost.** Our eval set must include genuine production tickets. Need to label 50 to 100 historical tickets manually before sprint 5, ideally during sprints 1-3 in parallel. Greg or a dedicated SME for ~4 hours of labeling.

**Two model providers.** GPT-4o (Azure OpenAI) + Gemini Flash means two contracts, two outage modes. Acceptable given the BDT Platform precedent. If either has a regional outage, the worker should fail soft (push to Linear with `needs-human-triage` and a note explaining the AI was unavailable) rather than queue indefinitely.

**Linear-side abandonment risk.** If Linear deprecates Triage Intelligence or changes the Asks pricing model, our story changes. Mitigation: the data we send is fully reconstructable from our DB; we could pivot to another tracker or build the missing pieces ourselves with limited code change because the Linear push step is one isolated module.

---

## 9. What I'd Like Greg's Input On Before Sprint 0

1. **Compliance posture for v1:** general / HIPAA-ready / CMMC-ready?
2. **Customer registry source of truth:** AIP customers table, or do we need a new one?
3. **Initial eval-set labeling:** can we get 50-100 tickets labeled by an SME during weeks 1 to 4?
4. **Linear plan tier confirmation** and willingness to lean on Triage Intelligence rather than rebuilding similar-ticket detection in v1.
5. **Customer pilot list:** which 3 friendly customers do we want for the beta in week 8?

---

*End of document.*