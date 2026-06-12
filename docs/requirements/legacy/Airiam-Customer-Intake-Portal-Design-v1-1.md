# Airiam Customer Intake Portal: Design & Best-Practice Analysis

**Document type:** Architecture & Design Proposal (pre-TDD)
**Version:** 1.1 (Draft, supersedes v1.0)
**Prepared by:** Greg Williams / Airiam Advanced Technologies
**Audience:** Internal architecture review (Kuk Yi, Daniel Chávez, Pedro Aquino)
**Status:** Draft for review

---

## 1. Executive Summary

This v1.1 supersedes v1.0 and incorporates the constraints decided in the kickoff review. The system is a customer intake portal with two front doors (a branded web portal and a flexible RESTful API), running each submission through an AI triage pipeline that uses both customer-supplied signals and Airiam-side internal context, then pushing a fully-classified issue into Linear's Triage queue. v1 is one-way (status flows back from Linear to the customer; comments do not sync in either direction). The same codebase deploys into two Azure tenants (Airiam and Canopy) with no shared data plane.

The most important shifts from v1.0 to v1.1:

1. **Real-time channel is Azure Web PubSub, not SignalR.** Web PubSub is the right Azure primitive for our TypeScript-on-the-client / Python-on-the-server pairing. SignalR's value is in the ASP.NET / Blazor ecosystem we don't use.
2. **Authentication is now explicitly multi-strategy.** Three principal types (end user via portal, end user via embedded app, service-to-service) with four auth methods (JWT bearer, HMAC-signed API keys, OAuth client credentials, and mTLS for the most sensitive monitoring callers). All strategies resolve to a single normalized `Principal` object inside the API.
3. **The API is multi-source.** Tickets arrive from at least three places: the customer portal, the in-app "Open a Ticket" button embedded in apps Airiam built, and Airiam's own monitoring of those apps. Each source has a different default trust level and different defaults that flow into AI triage.
4. **Two-tenant deployment, not multi-tenant data.** Same code, two Azure deployments (`intake.airiam.com` and an analogous Canopy domain). No customer-data crosses tenants. This is solved with Bicep parameterization, not application-layer multi-tenancy.
5. **SOC2 by default; no PHI / no CUI.** v1 ships with the audit trail, encryption posture, and access controls needed to meet SOC2. We're not handling PHI or CUI, which removes BAA and CMMC complexity from v1 scope but does not relax our security standards.
6. **One-way sync in v1.** Status flows Linear → portal → customer (email + Web PubSub). Comments do not flow either direction. Two-way is on the roadmap and explicitly designed for, but out of scope for v1.

The unchanged-from-v1.0 conclusions still hold:

- Sit *in front* of Linear, not next to it. We do not duplicate Linear Asks, Triage Intelligence, or Linear Agent.
- Pydantic AI with structured outputs and a union-type uncertainty path is the right triage pattern.
- Priority is computed deterministically from the impact/urgency matrix; the LLM does not output priority directly.
- Two-stage AI: a fast cheap filter (Gemini Flash) followed by a capable triage model (GPT-4o on Azure OpenAI).
- The intake portal is a sibling service in the AIP monorepo, sharing `airiam-auth`, `airiam-audit`, `airiam-events`, and `airiam-presidio` packages.

The rest of this document is the deep analysis that justifies and elaborates these decisions.

---

## 2. Updated Reference Architecture

```
┌───────────────────────────────────────────────────────────────────────────┐
│                  Airiam Customer Intake Portal (per tenant)               │
│                                                                           │
│  Three intake sources                                                     │
│  ┌──────────────┐  ┌────────────────┐  ┌───────────────────────────────┐  │
│  │ Web Portal   │  │ Embedded in    │  │ Airiam Monitoring             │  │
│  │ (Next.js 15) │  │ Customer Apps  │  │ (N-able, App Insights, Sentry)│  │
│  │              │  │                │  │                               │  │
│  │ JWT bearer   │  │ HMAC + asserted│  │ OAuth client_credentials      │  │
│  │ (Customer    │  │ user identity  │  │ or mTLS for most sensitive    │  │
│  │ Portal Acct) │  │                │  │                               │  │
│  └──────┬───────┘  └────────┬───────┘  └────────────────┬──────────────┘  │
│         │                   │                            │                │
│         └─────────┬─────────┴────────────────────────────┘                │
│                   │                                                       │
│                   ▼                                                       │
│         ┌──────────────────────────┐                                      │
│         │  Intake API (FastAPI)    │                                      │
│         │  ┌────────────────────┐  │                                      │
│         │  │ Auth Resolver      │  │  Tries each strategy; emits a        │
│         │  │ → Principal        │  │  normalized Principal; fails closed  │
│         │  └────────┬───────────┘  │                                      │
│         │           ▼              │                                      │
│         │  Source-aware adapters   │  N-able adapter, App Insights        │
│         │  (normalize to Ticket)   │  adapter, Sentry adapter, generic    │
│         │  ┌────────────────────┐  │                                      │
│         │  │ Validate + Persist │  │  WORM event written first            │
│         │  │ Emit               │  │  (received), 202 returned to client  │
│         │  └─────┬──────────────┘  │                                      │
│         └────────┼─────────────────┘                                      │
│                  │                                                        │
│                  ▼                                                        │
│         ┌────────────────────┐         ┌─────────────────────────────┐    │
│         │ Neon Postgres      │         │ Azure Service Bus           │    │
│         │  • tickets         │◄────────│  topic: ticket.submitted    │    │
│         │  • ticket_events   │         │  topic: ticket.triaged      │    │
│         │    (WORM, hash-   │         │  topic: ticket.status.changed│    │
│         │    chained)        │         └────────┬────────────────────┘    │
│         │  • principals      │                  │                         │
│         └────────┬───────────┘                  ▼                         │
│                  │                  ┌──────────────────────────┐          │
│                  │                  │ Triage Worker            │          │
│                  │                  │ (Pydantic AI agent)      │          │
│                  │                  │                          │          │
│                  │                  │ 1. Presidio scrub        │          │
│                  │                  │ 2. Source-aware default  │          │
│  ┌────────────┐  │  ┌────────────┐  │ 3. Customer context      │          │
│  │ Azure      │◄─┼──┤ Customer   │◄─┤    enrichment            │          │
│  │ OpenAI     │  │  │ DB         │  │ 4. Fast filter           │          │
│  │ (GPT-4o)   │  │  │ (AIP shared│  │    (Gemini Flash)        │          │
│  └────────────┘  │  │  table)    │  │ 5. Full triage (GPT-4o)  │          │
│  ┌────────────┐  │  └────────────┘  │ 6. Priority calc         │          │
│  │ Vertex AI  │◄─┼─────────────────►│ 7. Linear push           │          │
│  │ (Gemini    │  │                  └────────┬─────────────────┘          │
│  │ Flash)     │  │                           │                            │
│  └────────────┘  │                           ▼                            │
│                  │                  ┌──────────────────────────┐          │
│                  │                  │ Linear (per-tenant       │          │
│                  │                  │ workspace)               │          │
│                  │                  │                          │          │
│                  │                  │  • Issue in Triage       │          │
│                  │                  │  • Webhook fires on      │          │
│                  │                  │    state changes         │          │
│                  │                  └────────┬─────────────────┘          │
│                  │                           │                            │
│                  │                           ▼                            │
│                  │                  ┌──────────────────────────┐          │
│                  │                  │ Webhook Listener         │          │
│                  │                  │ (FastAPI, signature      │          │
│                  │                  │  verified)               │          │
│                  │                  │                          │          │
│                  │                  │  • Updates ticket status │          │
│                  │                  │  • Emits status.changed  │          │
│                  │                  └────────┬─────────────────┘          │
│                  │                           │                            │
│                  ▼                           ▼                            │
│         ┌──────────────────────────────────────────┐                      │
│         │ Notification Fanout                      │                      │
│         │  • Email (Azure Comms / SendGrid)        │                      │
│         │  • Web PubSub (live status to portal)    │                      │
│         └──────────────────────────────────────────┘                      │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

The same picture deploys twice: once in the Airiam tenant, once in the Canopy tenant. Different Azure resource groups, different Linear workspaces, different DNS, different secrets, identical code.

---

## 3. Real-Time Channel: Why Web PubSub

### 3.1 The Decision

Use **Azure Web PubSub**. Drop the SignalR option from v1.0.

### 3.2 The Reasoning

Microsoft's own decision guidance is unambiguous: SignalR Service is the right choice when you're already in the ASP.NET / Blazor ecosystem and want hub-style RPC semantics. Web PubSub is the right choice when you want generic real-time WebSocket pub/sub independent of any framework. Our client is Next.js / TypeScript and our server is FastAPI / Python; the SignalR Hub abstraction buys us nothing and the SignalR JS client carries weight we'd rather not ship.

What Web PubSub gives us specifically:

1. **Pure WebSocket plus pub/sub semantics.** Our use case is "the customer is looking at the status page; when their ticket's status changes, push the new status to them." That is one-to-one fanout keyed on user ID. Web PubSub's group-and-user model maps to this directly: each authenticated portal session joins a group named `user:<user_id>`; the Notification Fanout publishes to that group when an event for that user occurs.
2. **Native JWT auth.** Web PubSub validates a JWT we issue from the FastAPI side as the access token for the WebSocket connection. No extra auth dance, no SignalR negotiate endpoint, no session affinity to manage.
3. **Cleaner client.** The Next.js client uses the standard `WebSocket` browser API or the lightweight `@azure/web-pubsub-client` package. No SignalR client library, no fallback transport negotiation, no hub proxy generation.
4. **Better cost shape for our load.** Our concurrent connection count will be dominated by the small number of customer admins actively viewing the status page, not by mass broadcast. Web PubSub bills on connections + messages + connection minutes, which suits sparse intermittent traffic better than SignalR's unit-based pricing.
5. **Subprotocol flexibility for v2 and v3.** When we add two-way comment sync (v2), Web PubSub's `json.webpubsub.azure.v1` subprotocol gives us bidirectional events natively. SignalR can do this too, but Web PubSub is a cleaner fit if we ever need to expose this channel to a customer's own systems (an MQTT-over-WebSocket subprotocol is even available for IoT-adjacent integrations).

### 3.3 What v1 Actually Uses It For

Strictly server-to-client status notifications:

- Ticket received: confirmation pushed to the active portal session (in addition to the HTTP response).
- Triage complete: priority and assigned team pushed to the session.
- Linear status change: pushed to the session and queued as an email if the session is offline.

No client-to-server messaging over Web PubSub in v1. Customers submit and reply via REST. This keeps the surface area small and avoids needing to harden a websocket ingress for v1.

---

## 4. Multi-Source Intake Surfaces

The API is the design's load-bearing component because it has to serve four meaningfully different callers with the same Ticket model on the other side.

### 4.1 Customer Portal (Web)

**Caller:** a human customer using `intake.airiam.com` (or the Canopy equivalent).
**Auth:** JWT bearer obtained by signing into a Customer Portal Account.
**Default trust:** medium. Submitter is identified, but free-text content is unvalidated and can include spam or accidental PII.
**AI triage defaults:** full pipeline including Presidio scrub, fast filter (spam/quality), full triage.

### 4.2 Embedded in Customer Apps (BDT, AIP, OSCAR, FinOps, AR/AP)

**Caller:** an Airiam-built customer-facing app, with an end user already authenticated to that app, who clicked "Open a Ticket" inside the app.
**Auth:** the calling app authenticates to our API with HMAC-signed requests using a per-app service credential. The end user's identity is asserted in the body as `submitted_by_user_id` and `submitted_by_email`. Our API trusts the app's assertion of the user identity because we trust the app (it's our own code).
**Default trust:** high. The app has already authenticated the user and may have already collected structured fields (affected feature, error code, screenshot reference).
**AI triage defaults:** full pipeline, but with the app's pre-collected structured fields injected into the LLM context. The app passes `app_context` JSON describing the user's current state, recent actions, and any client-side error capture.

This is the single highest-value surface to get right because it generates the cleanest tickets. The user is one click away from submitting; the app pre-fills technical context the user could not supply on their own.

### 4.3 Airiam Monitoring of Customer Apps

**Caller:** N-able, Azure Application Insights, Sentry, or another monitoring system, alerting on a customer-facing app's behavior.
**Auth:** OAuth 2.0 client credentials flow for tools that support it (most modern monitoring). mTLS for the most sensitive callers where we want certificate-bound trust. HMAC API keys as the universal fallback.
**Default trust:** very high. These callers are Airiam systems, not customer-supplied input.
**AI triage defaults:** Presidio scrub still runs (alerts can include log fragments with customer data); fast filter is **bypassed** (no risk of spam from our own monitoring); full triage runs but with the alert's structured payload (severity, runbook URL, affected service, time range, sample log) used as primary signal. The customer is identified via the app/tenant tag in the alert.

We build adapters for the monitoring sources we expect to see on day one:

- **N-able** (RMM/N-central): MSP-side managed-services monitoring, relevant primarily on the Airiam tenant. Alerts arrive via N-able's webhook with a documented payload format.
- **Azure Application Insights / Azure Monitor**: alert rule action group webhooks with the standard `commonSchema` payload. Used for AIP, OSCAR, the intake portal itself, and any other Azure-hosted Airiam app.
- **Sentry**: frontend / backend errors with the standard Sentry webhook payload.
- **Generic webhook adapter**: a fallback that accepts any JSON, delegates to the LLM to extract structured fields, and tags the ticket with `source:generic-monitor` so we can build a proper adapter later if volume justifies it.

Each adapter is a small Pydantic model + a normalize-to-Ticket function. New adapters are a 50-to-100-line PR, not an architectural change.

### 4.4 Direct API Access

**Caller:** a customer's own automation, a partner integration, or an admin-side script.
**Auth:** HMAC-signed API key issued per customer.
**Default trust:** medium. Not as trusted as our own monitoring; not as opaque as portal-submitted text.
**AI triage defaults:** full pipeline, identical to portal submission, except the structured-fields path is preferred over free text wherever the API caller supplies it.

Rate limits per key: 100 req/min in v1, configurable per customer. Replay protection via timestamp window (5 min) plus nonce in the signature.

---

## 5. Authentication Strategy

The shape of the auth model is the single biggest source-of-bugs surface in v1, so it deserves a deep section.

### 5.1 Three Principal Types, One Resolved Object

Whatever auth method was used at the door, the API handler receives a single normalized `Principal`:

```python
# packages/airiam-auth/src/airiam_auth/principal.py
from typing import Literal
from pydantic import BaseModel
from uuid import UUID

class Principal(BaseModel):
    kind: Literal["end_user_portal", "end_user_via_app", "service"]

    # Always populated
    customer_id: UUID
    auth_method: Literal["jwt", "hmac", "oauth_cc", "mtls"]
    scopes: list[str]

    # Populated when the principal is a human
    user_id: str | None = None
    user_email: str | None = None

    # Populated for end_user_via_app
    app_id: str | None = None

    # Populated for service callers
    service_id: str | None = None
    service_kind: str | None = None  # 'monitoring', 'integration', 'admin'
```

Every audit log entry, every event in the WORM chain, and every Linear issue body carries this object verbatim. When something goes wrong, we know exactly who or what asked for it.

### 5.2 Auth Method Matrix

| Method | Used by | Why this method | Where validated |
|--------|---------|------------------|------------------|
| **JWT bearer** | Customer Portal users | Standard for browser-issued sessions; works natively with Web PubSub for the realtime channel | FastAPI dependency; signing key in Azure Key Vault, rotated |
| **HMAC-signed requests** | Embedded customer apps; direct API access | No round trip to an auth server; key never traverses the wire; replay-safe | FastAPI dependency; per-key secret in Key Vault, hashed in DB |
| **OAuth 2.0 client credentials** | Modern monitoring tools (Azure Monitor, Sentry, N-able where supported) | Standard for service-to-service among tools that already speak OAuth | Validated against an Entra ID app registration per service caller |
| **mTLS** | Highest-sensitivity monitoring (e.g., production-incident pagers) | Certificate-bound; cannot be replayed, leaked, or phished | Terminated at Azure Front Door / API Management; client cert thumbprint resolved to a service identity |

A single endpoint can accept multiple methods. The order of attempts is: JWT → HMAC → OAuth client credentials → mTLS. The first that validates wins; if all fail, the request gets a 401 with `WWW-Authenticate` listing acceptable schemes.

### 5.3 FastAPI Implementation Sketch

```python
# services/customer-intake/api/app/security.py
from fastapi import Depends, HTTPException, Request
from airiam_auth import Principal, jwt_strategy, hmac_strategy, oauth_cc_strategy, mtls_strategy

STRATEGIES = [jwt_strategy, hmac_strategy, oauth_cc_strategy, mtls_strategy]

async def authenticate(request: Request) -> Principal:
    last_exc = None
    for strategy in STRATEGIES:
        try:
            principal = await strategy(request)
            if principal:
                request.state.principal = principal
                return principal
        except Exception as exc:
            last_exc = exc
            continue
    raise HTTPException(401, detail="No valid authentication", headers={
        "WWW-Authenticate": 'Bearer, HMAC realm="airiam-intake", mTLS'
    })

# In the router:
@router.post("/v1/tickets")
async def submit_ticket(
    payload: TicketSubmission,
    principal: Principal = Depends(authenticate),
):
    ...
```

The handler never inspects how the caller authenticated. It uses `principal.kind` to set source-aware defaults and `principal.scopes` for authorization decisions.

### 5.4 Customer Portal Account Model

We're explicitly choosing **Customer Portal Accounts** (a directory we control) rather than asking customers to log in via their own Entra tenant. Two reasons:

1. **Friction:** customers are used to vendor portals having their own login. Asking them to federate would slow onboarding for the smaller customers.
2. **Identity normalization:** a customer admin manages their users through our portal, not through their own IT. We control password policy, MFA requirement, and lifecycle.

Implementation: **Entra External ID** (the rebranded Azure AD B2C). This gives us the directory, MFA, password policy, lockout, and audit logs out of the box, while still presenting as our portal. Cheaper, lower-risk, SOC2-friendly, and saves us from rolling our own identity store.

Account model:

- One **customer organization** per Airiam customer; provisioned by Airiam onboarding.
- Each organization has one or more **customer admins** (manage their users) and any number of **customer users**.
- Roles: `admin`, `submitter`, `read_only`.
- MFA: required for `admin`, optional but encouraged for `submitter`.
- Self-service password reset; admin-initiated user provisioning.

Single-Sign-On (SAML / OIDC federation against the customer's own IdP) is a v1.1 add for enterprise customers that want it. Designed in but not built in v1.

---

## 6. AI Triage: Updates for Multi-Source Intake

The schemas from v1.0 stand. Two additions for v1.1.

### 6.1 Source-Aware Defaults

The Pydantic AI agent receives a `source_context` block in its instructions:

```python
class SourceContext(BaseModel):
    principal_kind: Literal["end_user_portal", "end_user_via_app", "service"]
    source_subkind: str  # 'web', 'in_app:bdt', 'monitor:n-able', 'monitor:sentry', etc.
    pre_collected_fields: dict   # populated for in-app and monitor sources
    customer_context: dict       # tier, SLA, recent deploys, open P1s
```

Source-specific defaults baked into the prompt:

- **Portal submissions:** treat as raw user text. Default urgency and impact to `unknown`; let the model infer.
- **In-app submissions:** trust pre-collected fields if present; the user clicked "this feature is broken" so `incident` is the strong prior.
- **Monitoring-originated:** pre-set `incident` as ticket type, severity from the alert maps to initial urgency, the model adjusts based on customer-context (a P1 alert on a Tier-3 customer with no active SLA may merit P2 rather than P1).

This isn't a different agent, it's the same agent with stronger priors on different sources. Empirically, structured-output agents with informative priors substantially outperform agents that have to discover the source from text.

### 6.2 Internal Content RAG: Roadmap Made Explicit

You said internal content will improve over time. Two corpora to build:

**Corpus A: historical tickets.** Embed every triaged ticket's title + description + final classification + resolution. Stored in Neon's `pgvector` index. v2 retrieval: top-5 most-similar past tickets, surfaced to the agent as context. This both improves classification accuracy and gives the developer in Linear a "we've seen this before" link.

**Corpus B: runbooks and KB.** Index Airiam's runbooks, Confluence pages, the OSCAR / BDT / AIP TDDs, GitHub wiki content, and any vendor docs (Linear, NexHealth, Vyne, etc. for the OSCAR side). v2 retrieval: top-3 relevant docs surfaced as context for both classification and (eventually) draft resolution proposal.

The pgvector column is added to the `tickets` table in v1 (cheap, takes no time), but RAG retrieval is not wired in until v2. This gives us a backfilled corpus when v2 lands.

Critical guardrail: **the AI never sees customer A's tickets when triaging customer B's tickets.** Embeddings are scoped to the customer at query time. This is non-negotiable for SOC2 logical-isolation claims.

---

## 7. SOC2 Posture and Audit Trail

You said "no PHI, no CUI, but we need to handle securely because we are SOC2 and will have audit trails." Here is what that means concretely.

### 7.1 Control Mapping

| SOC2 Trust Service Criterion | What our design satisfies |
|------------------------------|----------------------------|
| **CC6.1 Logical access** | Customer Portal Accounts via Entra External ID; RBAC with least-privilege scopes; per-API-key scopes; no shared accounts |
| **CC6.6 Encryption in transit** | TLS 1.2+ enforced everywhere; mTLS available for sensitive monitoring; Web PubSub uses WSS; Linear API is HTTPS |
| **CC6.7 Encryption at rest** | Neon Postgres (Azure-side) with default encryption; Key Vault holds secrets; customer-managed keys (CMK) configurable per tenant if Canopy demands it |
| **CC7.1 Detection of security events** | OTel + App Insights ingestion of all auth failures, authorization denials, signature verification failures; alert rules into the same N-able-managed monitoring channel that fires our own intake |
| **CC7.2 Monitoring** | Logfire dashboards for AI triage performance; App Insights for API latency/errors; per-tenant dashboards |
| **CC8.1 Change management** | All deploys via `azd` from main; PR reviews required; preview environments for any change touching auth or data model; ADRs locked before code |
| **CC9.2 Risk mitigation (vendor)** | Subprocessor list maintained; data-flow map maintained; vendor security reviews on file; see §7.3 |

### 7.2 The Audit Trail

Two layers:

**Layer 1: WORM event chain (RAIVS-style).** Every state change to a ticket appends to `ticket_events`. Each row carries `prev_hash` and `this_hash`; the chain is forward-secure (per the patent-pending RAIVS pattern from OSCAR; we re-use the library, we do not redocument the algorithm). Events captured:

- `ticket.received` (initial submission, with full Principal)
- `ticket.triaged` (AI output and confidence)
- `ticket.pushed_to_linear` (Linear issue ID)
- `ticket.linear_status_changed` (status transitions back from Linear)
- `ticket.notification_sent` (email or Web PubSub delivery)
- `ticket.failed` (any pipeline failure)

**Layer 2: access log.** Every API call (success or failure) writes to an append-only table with caller identity, IP, request signature, response code, and request/response bodies (PII-scrubbed). This is the audit log your SOC2 auditor will want to spot-check.

Both layers replicate to Azure Storage with immutable blob policy as a daily archive. 7-year retention by default (configurable per tenant).

### 7.3 Subprocessor List and Data Flow

This is a doc the auditor will ask for. Drafting it now so it isn't a fire drill at audit time.

| Subprocessor | Role | Data they see | Justification |
|--------------|------|---------------|---------------|
| **Microsoft Azure** | Hosting (compute, storage, network, Key Vault, Service Bus, Web PubSub, App Insights) | All ticket data, audit logs | Primary cloud provider; existing AIP relationship |
| **Azure OpenAI** | LLM inference (GPT-4o) | Redacted ticket text + customer context (tier, deploys); never raw PII | Tenant-isolated Zero Data Retention configuration; same posture as SS-RAG |
| **Google Vertex AI** | LLM inference (Gemini Flash) | Redacted ticket text only; never customer context | Used as fast filter; limited surface area |
| **Neon (Azure-hosted)** | Postgres + pgvector | All ticket data | Standard AIP database |
| **Linear** | Issue tracking | All triaged tickets pushed to Linear | This is the system of record on the dev side; Greg-acknowledged dependency |
| **Microsoft Entra External ID** | Customer Portal identity | User profile data only | Identity provider for the portal |
| **Email provider (Azure Communication Services or SendGrid)** | Transactional email | Ticket subject lines, statuses, links | Notifications; no full ticket bodies in email |

PII redaction via Microsoft Presidio runs **before** any data leaves our boundary for an LLM call. Customer-identifying fields (org name, user email) are template-substituted; sensitive content is scrubbed.

### 7.4 What "secure handling without PHI" Means Concretely

Because we're explicitly carving out PHI and CUI, we make the following commitments visible to customers:

- The portal Terms of Service prohibit submitting PHI or CUI. Submission forms have a tiny note to that effect.
- The Presidio scrub still runs as a defense-in-depth measure (customers will paste the wrong thing eventually).
- If Presidio detects PHI markers (DOB-shaped strings, SSN-shaped strings, MRN-shaped strings), the ticket is auto-flagged `pii-detected`, redacted in the LLM call, and a Linear comment alerts the assignee.
- We do not sign BAAs in v1. Any customer that needs HIPAA mode is escalated to a separate conversation; the Canopy deployment is positioned as a hosted instance for Canopy's customer support workflows, not a PHI-handling system.

---

## 8. Two-Tenant Deployment (Airiam + Canopy)

### 8.1 The Core Principle

**Same code, two deployments, no shared data plane.** The Airiam tenant and the Canopy tenant are isolated end to end: separate Azure subscriptions or at minimum separate resource groups, separate Key Vaults, separate Postgres clusters, separate Linear workspaces, separate Entra External ID tenants for portal accounts.

This is not multi-tenancy at the application layer. The application doesn't know it's being deployed twice; deployment-time configuration tells it which world it's in.

### 8.2 Tenant Configuration Schema

A single `TenantConfig` Pydantic model materializes from environment variables on startup:

```python
class TenantConfig(BaseModel):
    tenant_slug: Literal["airiam", "canopy"]
    tenant_display_name: str
    portal_url: str  # e.g., 'https://intake.airiam.com'
    api_url: str

    # Linear
    linear_workspace_id: str
    linear_default_team_mapping: dict[str, str]  # source -> Linear team ID
    linear_api_key_secret_ref: str  # Key Vault reference

    # Entra External ID
    entra_tenant_id: str
    entra_audience: str
    entra_signing_keys_url: str

    # Branding
    brand_primary_color: str
    brand_logo_url: str
    brand_email_from: str

    # Compliance toggles
    require_mfa_for_admins: bool = True
    pii_detection_strict_mode: bool = True
    audit_retention_days: int = 2555  # 7 years default
```

### 8.3 Bicep Structure

```
infra/
├── main.bicep                       # Top-level: composes the modules
├── modules/
│   ├── intake-api.bicep             # Container app or App Service
│   ├── triage-worker.bicep          # Container app
│   ├── webhook-listener.bicep       # Function or Container app
│   ├── web-pubsub.bicep
│   ├── service-bus.bicep
│   ├── key-vault.bicep
│   ├── neon-private-link.bicep      # Or whatever the AIP pattern is
│   ├── front-door.bicep             # Plus WAF
│   └── monitoring.bicep             # App Insights, Log Analytics
├── parameters/
│   ├── airiam.dev.bicepparam
│   ├── airiam.prod.bicepparam
│   ├── canopy.dev.bicepparam
│   └── canopy.prod.bicepparam
└── azd/
    ├── azure.airiam.yaml
    └── azure.canopy.yaml
```

Each parameter file is small (50 lines), sets the tenant slug, the resource-group name, the Key Vault name, the DNS for the portal, and references to the secrets (which are populated out-of-band via `az keyvault secret set` during onboarding). `azd up --environment airiam-prod` deploys the Airiam production tenant; same for Canopy. No code change to switch.

### 8.4 The Linear Workspace Question

Each tenant points at its own Linear workspace. The Airiam deployment pushes into the Airiam workspace; the Canopy deployment pushes into Canopy's workspace (likely the existing OSCAR development workspace, but that's a Canopy decision not an Airiam one). The team-mapping config in `TenantConfig` controls which Linear team gets which kind of ticket.

This also means **the same human can be a Linear user in both workspaces with different roles**, which is fine. The intake portal doesn't care; it pushes via a workspace-scoped API key in each tenant's Key Vault.

### 8.5 Branding

The Next.js portal reads `TenantConfig` at SSR time and applies brand colors, logo, and copy. One CSS-variable theme per tenant, plus per-tenant string tables for any tenant-specific copy. No code branching: a Canopy-branded portal at `intake.canopydental.com` is the same Next.js bundle with different env values.

**Important standing rule applied:** the Canopy deployment of this system never displays the word "Airiam" anywhere customer-facing, per Greg's standing instruction. The TenantConfig `tenant_display_name` controls every visible string.

---

## 9. One-Way Sync (with Two-Way Roadmap)

### 9.1 What v1 Does

- **Outbound to Linear:** every triaged ticket pushed as a new issue in Triage status.
- **Inbound from Linear:** webhook listener captures `Issue` resource changes (status transitions, assignment changes, label changes), updates our DB, fires `ticket.linear_status_changed` events.
- **Outbound to customer:** email + Web PubSub on status change.
- **Inbound from customer:** none after submission. The customer cannot reply on a ticket. If they have more to say they submit a follow-up ticket; we deal with merging on the Linear side.

### 9.2 Why This Is Right for v1

You said one-way. That's directionally correct because it sidesteps the hardest single problem in customer-support tooling: comment threading and state reconciliation across two systems. Half-done two-way sync is worse than no sync at all.

The cost of one-way: customers will sometimes want to add information to an existing ticket. v1 mitigation is a clear "submit a follow-up" UX in the portal that creates a child ticket linked to the parent. The Linear assignee sees both linked.

### 9.3 What v2 Two-Way Looks Like

When we do v2:

- Customer comments on the portal write to a `customer_comments` table and post a Linear comment via API, tagged `customer-visible`.
- Linear comments tagged `customer-visible` (filterable by an `internal-only` label that excludes the rest) sync back to the portal and trigger an email.
- Web PubSub channel becomes bidirectional for live comment notifications.
- We add a soft moderation step (LLM-checks customer-visible Linear comments for tone and PII before sending) because the audience changes.

The architecture in v1 already supports v2: the comment table exists conceptually but is not exposed; the Web PubSub group model already handles per-user delivery; the webhook listener already filters Linear events by resource type. v2 is mostly UX and the moderation layer.

---

## 10. ADRs (Updated)

ADRs from v1.0 that **remain in force**:

- **ADR-INTAKE-001:** Sit in front of Linear, not next to it.
- **ADR-INTAKE-002:** Pydantic AI with structured outputs and union-type uncertainty.
- **ADR-INTAKE-003:** Priority is deterministic, computed from impact and urgency.
- **ADR-INTAKE-004:** Two-stage classification (Gemini Flash + GPT-4o).
- **ADR-INTAKE-006:** Customer Intake is a sibling service in the AIP monorepo.
- **ADR-INTAKE-008:** Confidence-gated automation.

ADRs **replaced or added** in v1.1:

**ADR-INTAKE-005 (replaced): Customer Portal Accounts via Entra External ID; API uses pluggable strategies.**
The web portal authenticates customers against Entra External ID (we control the directory). The API supports JWT, HMAC, OAuth client credentials, and mTLS in priority order. All resolve to a single normalized Principal. *Consequences:* lower onboarding friction for customers; flexibility for embedded-app and monitoring callers; one auth-related code path in handlers.

**ADR-INTAKE-007 (replaced): SOC2-grade controls by default; no PHI, no CUI.**
v1 ships with the audit chain, encryption posture, MFA-for-admins, and subprocessor map needed for SOC2. We explicitly do not handle PHI or CUI. Presidio scrubs as defense in depth. *Consequences:* one compliance posture to maintain; customers requiring HIPAA mode are out of v1 scope and escalated separately; the Canopy deployment is non-PHI.

**ADR-INTAKE-009 (new): Real-time channel is Azure Web PubSub.**
SignalR Service is dropped from consideration. Web PubSub fits our TypeScript / Python stack and our use case (server-to-client sparse fanout). *Consequences:* no SignalR client library on the frontend; cleaner JWT integration; subprotocol flexibility for v2.

**ADR-INTAKE-010 (new): The API is multi-source with source-aware AI defaults.**
Tickets arrive from the customer portal, embedded customer apps, Airiam monitoring, and direct API. Each source carries different priors into AI triage. *Consequences:* richer triage on high-trust sources; cleaner separation of monitoring-originated incidents from customer-reported issues.

**ADR-INTAKE-011 (new): Two-tenant deployment, no shared data plane.**
Same code deploys into the Airiam tenant and the Canopy tenant. No multi-tenancy in the data layer. Bicep parameterization controls tenant identity. *Consequences:* zero risk of cross-tenant data leakage; doubled infrastructure cost (acceptable); deployment automation does the work.

**ADR-INTAKE-012 (new): One-way sync in v1, two-way explicitly designed for in v2.**
Status flows from Linear back to the customer; comments do not sync in either direction. The data model and channels are designed so v2 two-way is an additive change, not a re-architecture. *Consequences:* simpler v1; clear UX expectation set with customers; deferred moderation layer.

---

## 11. Updated Sprint Plan

| Sprint | Duration | Owner(s) | Deliverables |
|--------|----------|----------|--------------|
| **0** | 1 week | Greg | This doc reviewed and ADRs locked with Kuk Yi; Linear OAuth apps registered for both tenants; Entra External ID directories provisioned; Azure subscriptions / RGs created for both tenants; secrets seeded |
| **1** | 2 weeks | Daniel + Pedro | API skeleton with the auth resolver and all four strategies; Customer Portal Account flow with Entra External ID; DB schema + migrations; Web PubSub provisioned; Bicep modules and per-tenant parameter files |
| **2** | 2 weeks | Daniel | Triage worker with Pydantic AI agent; Presidio inline; fast filter; full triage; priority calc; Linear push happy path; the three v1 monitoring adapters (N-able, App Insights, Sentry) |
| **3** | 1 week | Daniel + Pedro | Linear webhook listener with signature verification; status-change events; email and Web PubSub fanout; customer status page in the portal |
| **4** | 1 week | Pedro | In-app submission widget reference implementation (the snippet customer apps embed); embedded-flow auth; documentation |
| **5** | 1 week | Greg + Daniel | Eval set built from 50 to 100 historical tickets; accuracy measurement; threshold tuning; Logfire + App Insights dashboards; SOC2 audit-readiness checklist walked end to end |
| **6** | 1 week | All | Beta launch into the Airiam tenant with three friendly customers; Canopy tenant deployment dry run |

Beta acceptance gates: triage accuracy ≥ 85% on the eval set; audit chain integrity verified in load test; no critical findings in a security review pass; two-tenant deployment works without code change.

---

## 12. Cost Model (Order of Magnitude)

Per ticket cost, assuming 1,000 tickets/month per tenant initially:

| Component | Per-ticket cost | Notes |
|-----------|------------------|-------|
| Gemini Flash (fast filter) | ~$0.0002 | ~500 input tokens, 50 output tokens |
| GPT-4o (full triage) | ~$0.012 | ~3000 input tokens (with context), 400 output tokens |
| Presidio | ~$0.00005 | Self-hosted, infrastructure cost only |
| Linear API | $0 | Within free GraphQL quota |
| Postgres + pgvector | ~$0.0001 | Storage + compute amortized |
| Azure infra (per tenant) | ~$200/mo fixed | Web PubSub, Service Bus, container apps, App Insights |
| **AI cost per ticket** | **~$0.012** | |
| **All-in per ticket at 1,000/mo** | **~$0.21** | Including amortized fixed infra |

At scale (10,000 tickets/month per tenant), the per-ticket all-in drops to roughly $0.03, dominated by the GPT-4o call. A pure GPT-4o-mini variant of the triage agent would drop the LLM cost by roughly 6x at some accuracy cost; we hold this in reserve as a tuning lever once we have eval data.

This is well inside the value envelope: a single avoided escalation saves more than a month of all-in cost.

---

## 13. Risks & Open Questions

**Customer Portal Account UX vs. SSO.** Some larger customers will want SAML / OIDC federation against their own IdP. v1 doesn't include this; v1.1 should. Question: do any of the three beta customers we pick require federation? If yes, we may need to pull this into v1 scope.

**Embedded-app submission widget.** v1 sprint 4 produces a reference embed for one app (probably BDT, since you have it in production with ~90 active twins). Rolling it out across BDT, AIP, OSCAR, FinOps, and AR/AP is a per-app integration task we'll need to schedule with the respective owners. This is outside v1 scope but is the next thing.

**Monitoring source coverage.** N-able, App Insights, and Sentry are the day-one adapters. Anything else (Datadog, PagerDuty, custom) goes through the generic adapter until volume justifies a dedicated one. Question: are there specific monitoring tools any of our beta customers use that we should add to day-one?

**Linear plan tier per tenant.** Triage Intelligence and Linear Agent are Business+. Both Airiam's and Canopy's Linear workspaces need to be on Business+ to get the most value from this system. Confirmation needed for both.

**Customer Portal Account onboarding workflow.** Who provisions the customer admin account in Entra External ID, and through what tool? Likely a small admin UI in the portal itself for Airiam internal users. Specify in sprint 0 or 1.

**Eval set labeling effort.** We need 50 to 100 historical tickets manually labeled by an SME during sprints 1 to 4 so they're ready by sprint 5. ~4 to 6 hours of work. Greg or designated SME.

**Two-way sync demand from beta.** v1 is one-way deliberately. If beta customers push back hard, two-way moves up. The architecture supports it; the work is the moderation layer plus the UX. Plan for one extra sprint if pulled in.

---

## 14. What I'd Like Greg's Decision On Before Sprint 0

1. **Beta customer list** for the Airiam tenant. Three customers, ideally a mix of MSP-only, app-customer, and a friendly large account.
2. **Canopy tenant timing.** Does the Canopy deployment go live in parallel with Airiam beta, or is it a v1.1 follow-up? Recommendation: parallel deployment, Canopy in dry-run / shadow mode until OSCAR has its first friendly user.
3. **SSO requirement.** Federation in v1 or v1.1?
4. **Embedded-widget rollout plan.** Which Airiam app gets the in-app widget first after BDT, and on what timeline?
5. **AIP customer registry confirmation.** The triage worker enriches with customer tier, SLA, recent deploys. AIP `customers` table is the source of truth. Confirm we are not pulling this from a separate CRM.
6. **Patent angle.** The combination of (RAIVS hash-chain audit + dual-source impact scoring + confidence-gated triage + multi-source intake including monitoring) may be patent-worthy, particularly if combined with the BDT behavioral-twin signal as a future v3 input. Worth a separate conversation with patent counsel.

---

*End of document.*