# Airiam Advanced Tech Division - Engineering Delivery and CI/CD Process

- **Version:** 2.0 draft
- **Scope:** Team-wide development, quality, release, observability, security, and agentic delivery practices
- **Reference inputs:** Airiam CI/CD baseline, Shared Support RAG process, Financial Operations process, and active project `AGENTS.md` / `CLAUDE.md` conventions
- **Date:** May 2026

---

## 1. Executive Summary

This document defines the standard ATD delivery process. The file name says "CI/CD", but the intent is broader: it is the operating model for how work is planned, implemented, reviewed, validated, monitored, and released across Airiam engineering projects.

The baseline is simple:

1. Work starts from a scoped Linear issue, project roadmap item, or approved operational need.
2. The developer or coding agent reads the repo's `AGENTS.md`, relevant docs, and current code before making changes.
3. Work happens on a focused branch from `dev`.
4. Local checks run before push.
5. A PR into `dev` runs CI quality gates, coverage checks, security checks, and automated AI review where configured.
6. A human reviews and approves before merge.
7. Merge to `dev` deploys or prepares the development environment.
8. Promotion to `main` happens through a reviewed release PR, staging validation, and production approval.
9. Observability, incidents, and lessons feed back into the repo's instructions, skills, tests, and Linear backlog.

The goal is not to force every project into identical code structure. The goal is to standardize the engineering control plane: branching, PR gates, agent instructions, Linear integration, MCP usage, observability, security, testing, release, and feedback loops.

---

## 2. Process Goals

This process is designed to:

- Make engineering work traceable from Linear card to PR, deployment, and production signal.
- Reduce hidden project knowledge by encoding it in `AGENTS.md`, `CLAUDE.md` when present, project docs, lessons, and selected skills.
- Make CI quality gates consistent enough that leadership can trust green checks across projects.
- Use coding agents deliberately, with scoped skills and explicit review gates rather than random prompt-by-prompt behavior.
- Make MCP integrations useful and governed: Linear, databases, observability, GitHub, and deployment tooling should accelerate work without bypassing security or review.
- Keep production releases reproducible, observable, and rollback-ready.

---

## 3. Applicability and Project Overrides

This is the ATD baseline. Individual repositories may specialize it through their own `AGENTS.md`, architecture docs, and workflow files.

When sources disagree, use this precedence:

1. Actual code, runnable configuration, CI workflows, and deployment configuration in the repository.
2. Project source-of-truth docs, especially architecture, roadmap, runbooks, and decision registers.
3. Root `AGENTS.md`.
4. `CLAUDE.md`, `.codex/`, `.claude/`, or other agent-specific instruction files, when present.
5. This team-level process document.
6. Other root markdown files and historical notes.

Project-specific rules may be stricter than this baseline. Examples:

- A TypeScript-only Next.js repo may require `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`.
- A Python backend may require `ruff`, `basedpyright`, `pytest`, and coverage.
- A regulated or tenant-scoped project may require security review on every data-access change.
- A repo may require spec-first subagent orchestration for every implementation task.

No project should silently weaken the baseline. If a repo needs a lower bar for a temporary reason, document the exception, owner, expiration condition, and compensating control.

---

## 4. Standard Repository Contract

Every active ATD repository should have a small set of durable control files.

| File or folder | Purpose |
|---|---|
| `AGENTS.md` | Primary instructions for coding agents and humans working with agents. Includes stack, architecture boundaries, testing commands, security rules, and Definition of Done. |
| `CLAUDE.md` | Optional Claude Code-specific orchestration layer. Often includes subagent pipeline, effort levels, and lessons workflow. Should point back to `AGENTS.md`, not contradict it. |
| `docs/` | Architecture, roadmap, decisions, runbooks, phase plans, and historical context. Legacy references must be clearly marked. |
| `.github/workflows/` | CI, security, review, release, and deployment workflows. |
| `.env.example` or `.env.local.example` | Non-secret environment variable template. Real secrets never go here. |
| `tests/` | Unit, integration, E2E, evaluation, or migration tests, depending on project type. |
| `infra/`, `infrastructure/`, `.azure/`, or equivalent | Infrastructure-as-code and deployment configuration when applicable. |
| `.claude/lessons/`, `*_lessons.md`, or equivalent | Durable feedback memory for repeated implementation patterns and failures. |
| `.claude/skills/`, `.codex/skills/`, `.agents/skills/` | Repo-local skills when the project needs custom agent behavior. |

The minimum `AGENTS.md` sections are:

- Project identity and scope guardrails.
- Documentation precedence.
- Stack and package manager.
- Repository structure.
- Architecture boundaries and dependency direction.
- Branching and PR workflow.
- Linear workspace or project scope, when Linear is used.
- MCP usage rules, when MCPs are available.
- Testing and validation commands.
- Security and secrets rules.
- Definition of Done.
- Selected skills index and routing rules.

---

## 5. Branching and Release Model

The default branch model is:

```text
main ─────────────────────────────────●────────────── (production-ready)
                                     ╱
dev ────────●─────●─────●───────────● ─────────────── (integration)
           ╱     ╱     ╱           ╱
feature/  ●─────●     ╱           ╱
                     ╱           ╱
feature/            ●───────────●
```

| Branch | Purpose | Rules |
|---|---|---|
| `feature/<short-description>` | Normal implementation work. | Branch from latest `dev`. PR back to `dev`. Keep small and short-lived. |
| `hotfix/<short-description>` | Urgent production fix. | Branch from `main`, PR to `main`, then back-merge or PR into `dev`. |
| `dev` | Integration branch. | Protected. No direct pushes. Merge only through PR with passing checks. |
| `main` | Production-ready branch. | Protected. Merge only through reviewed release PR or hotfix PR. |
| `project/<name>` | Optional long-running integration branch for a large submodule or program. | Must be documented in `AGENTS.md`, including target branch and merge policy. |

Default rules:

- Never push directly to `dev` or `main`.
- Delete feature branches after merge.
- Keep PRs reviewable. If work grows too large, split it into Linear subtasks and smaller branches.
- Every commit or PR should reference the relevant Linear issue when one exists.
- Coding agents never approve PRs. Human approval is mandatory.
- Infrastructure, deployment, authentication, authorization, tenant isolation, and security changes require explicit human review.

---

## 6. Linear as the Work Control Plane

Linear is the preferred system of record for planned work, defects, follow-ups, and out-of-scope findings.

Every project using Linear must document:

- Workspace.
- Team.
- Project.
- Required labels or issue types.
- Status workflow.
- MCP server or connector allowed for that repo.
- Rules for creating, updating, and moving issues.

Default workflow:

1. Work starts from a Linear issue, roadmap item, or explicitly approved operational request.
2. Branch names and PR descriptions reference the issue identifier.
3. PR body includes the Linear ticket or `N/A`.
4. When a PR is ready, the issue moves to the project's review status.
5. When merged to `dev`, the issue moves to the project's integration or done status, depending on local policy.

Out-of-scope bug protocol (MANDATORY when an agent or reviewer surfaces an unrelated defect):

1. Capture the finding verbatim: file path and line, observed behavior, expected behavior, risk.
2. Search Linear (via the project-approved MCP) for an existing open issue covering it.
3. If none exists, draft a short spec for the defect (objective, repro, acceptance criteria) and create a Linear issue through the project's MCP server in the correct workspace, team, and project. Label it appropriately (for example `bug`).
4. Reference the new Linear ID in the current PR body under an `Out-of-scope follow-ups` heading.
5. Do not silently fix unrelated findings in the current PR. Only expand scope when the user or project lead explicitly redirects it.

Do not record out-of-scope bugs in PR text alone — they get lost. The Linear ticket plus a short spec is the durable record.

For agent use, Linear MCP access must be scoped to the correct workspace, team, and project. Using a personal or wrong-workspace Linear connector for project work is a process violation.

---

## 7. Agentic Development Model

ATD uses coding agents as part of the engineering workflow, not as an unreviewed replacement for engineering judgment.

### 7.1 Standard Agent Rules

Agents must:

- Read the repo's `AGENTS.md` before non-trivial work.
- Explore relevant files and current implementation before choosing an approach.
- Use selected skills that match the task rather than pulling in large, unrelated skill catalogs.
- Preserve project architecture boundaries.
- Run relevant verification before claiming completion.
- Summarize changes, tests, deferred items, and risks.
- Avoid creating secrets, credentials, production data, or undocumented architecture changes.
- Avoid approving PRs or taking externally visible actions without human approval.

### 7.2 Task Complexity Tiers

Projects may enforce stricter tiers. This is the default ATD model.

| Tier | Examples | Required process |
|---|---|---|
| Tier 0: Small safe change | Typo, docs cleanup, config comment, tiny test-only update. | Read relevant instructions, make focused change, run targeted check if useful. |
| Tier 1: Normal implementation | Feature slice, bug fix, API change, UI change, provider adapter, migration. | Explore, plan, select skills, implement, test, run local checks, prepare PR notes. |
| Tier 2: High-risk or cross-cutting | Auth, RLS, tenant isolation, money movement, migrations, infra, deployment, security, production incident. | Spec or written plan, human checkpoint when needed, tests before or alongside code, full local checks, security review, explicit rollout and rollback notes. |
| Tier 3: Program-level or multi-agent work | Multi-repo change, major refactor, new deployment path, large product phase. | Linear epic or project plan, phase plan, task decomposition, subagent routing, quality gates per subtask, leadership-visible progress tracking. |

### 7.3 Optional Subagent Pipeline

For projects with mature agent harnesses, a Linear card can move through a structured pipeline:

```text
Linear issue
  -> spec
  -> plan
  -> tests
  -> implementation
  -> E2E validation
  -> CI gate
  -> architecture review
  -> security review
  -> lessons update
  -> commit / push / PR
```

Recommended subagent roles:

| Role | Responsibility |
|---|---|
| spec-writer | Convert Linear card into implementation spec, acceptance criteria, and E2E plan. |
| planner | Identify files, dependencies, sequencing, risks, and verification commands. |
| test-writer | Add or update tests before implementation when feasible. |
| backend-builder | Implement backend, provider, database, or service changes. |
| frontend-builder | Implement UI, state, forms, and frontend data flows. |
| e2e-tester | Execute browser or API user flows against the spec. |
| ci-runner | Run the local CI matrix and report failures. |
| reviewer | Review architecture, maintainability, and project conventions. |
| security-reviewer | Review auth, data isolation, secrets, injection, dependencies, and logs. |
| teacher | Extract reusable lessons into the repo's lesson files or skills. |

This pipeline is a pattern, not a universal mandate. A repo may make it mandatory in `CLAUDE.md` or `AGENTS.md`; if it does, agents must follow that local rule.

### 7.4 Effort and Model Tiering

Subagent dispatch should pick the smallest capable model. A repo's `CLAUDE.md` declares the per-role tier; this is the recommended baseline.

| Role | Effort | Suggested model | Why |
|---|---|---|---|
| spec-writer | max | Opus | Spec quality compounds across the pipeline. |
| planner / orchestrator | max | Opus | Architecture and sequencing decisions. |
| reviewer | max | Opus | Catches design and pattern violations. |
| security-reviewer | max | Opus | Tenant isolation, auth, secrets, injection. |
| teacher (lessons extractor) | max | Opus | Lessons compound; bad lessons compound worse. |
| backend-builder | xhigh | Sonnet | Cost-efficient with a strict CI gate. |
| frontend-builder | xhigh | Sonnet | Cost-efficient with a strict CI gate. |
| test-writer | low | Haiku | Mechanical, pattern-driven work. |
| e2e-tester | low | Haiku | Executes a fixed test plan. |
| ci-runner | low | Haiku | Runs commands and reports output. |

Projects are free to override based on stack risk. The principle: do not pay Opus rates for mechanical execution, and do not run Opus-tier work on Haiku.

### 7.5 Parallel vs Serial Agent Execution

Some pipeline stages can and should run in parallel; others must run sequentially. The default rule: independent read-only or read-mostly work runs in parallel; work that mutates the same files runs sequentially.

Parallel by default:

- `reviewer` and `security-reviewer` after CI passes (both read-only against the same diff).
- Independent exploration agents (one inspects backend, another inspects frontend) when scoping a cross-cutting change.
- `Explore`-style search agents fanning out across different parts of the repo.
- Cross-agent comparison runs (for example: one Claude agent + one Codex agent reviewing the same PR for a second opinion).

Serial by requirement:

- `spec → plan → test-writer → builder → e2e-tester → ci-runner` is a hard chain. Each stage reads the output of the previous.
- Any time two agents would edit the same file or directory.
- Anything externally visible (Linear writes, PR comments, merges) — serialize to keep the audit trail clean.

A repo `CLAUDE.md` may declare which pairs are routinely parallel. Agents should state in the orchestration message which stages they are running in parallel and why.

---

## 8. Skills Strategy

Skills are targeted accelerators. They should reinforce project rules, not override them.

### 8.1 Curation Principle (Indexed Skills Beat Random Skills)

The agent's awareness of skills is a function of how clearly they are indexed and routed. A short, curated, explicitly indexed list in `AGENTS.md` consistently beats a sprawling catalog. Reasons:

- The agent reasons over the index it can see in the prompt context. A 10-skill list with named routes is acted on. A 100-skill catalog is mostly ignored.
- Curated skills carry shared assumptions (testing conventions, coding standards, security rules). Random skills do not.
- Skill drift (stale, contradictory, or unmaintained skills) silently degrades agent quality. Curation is how that drift gets caught.

ATD standard:

- Maintain an indexed, curated skill list in `AGENTS.md` with a one-line purpose statement per skill.
- Prefer a small set of high-signal skills over many random skills, regardless of what catalogs are technically available to the agent.
- Route tasks to skills by domain (see §8.2).
- Require non-trivial tasks to state which skill is being used and why (Vercel-style prompting protocol).
- Add a repo-local skill only when a repeated workflow cannot be captured cleanly in `AGENTS.md`, docs, or lessons. New skills are a last resort, not a first one.
- Audit the skill list every phase or quarter; remove or replace anything stale.

### 8.2 Skill Routing (Default Chains)

The skill names below are a recommended ATD routing baseline. A repo's `AGENTS.md` remains the authority for which skills are actually installed, approved, and expected for that project. Repos may pin to fewer skills or add repo-local skills when the local instructions document them.

| Task type | Default skill chain |
|---|---|
| Spec / planning before implementation | `$spec-writer` |
| Debugging | `$systematic-debugging` |
| Before completion / pre-PR review | `$verification-before-completion` → `$simplify` → `$polish` |
| CI/CD or GitHub Actions | `$github-actions-templates` |
| REST API design | `$api-design-principles` → `$error-handling-patterns` |
| PostgreSQL schema / query design | `$postgresql` → `$sql-optimization-patterns` |
| Next.js App Router / RSC boundaries | `$next-best-practices` → `$react-best-practices` |
| Next.js cache strategy (cacheLife / cacheTag) | `$next-cache-components` |
| UI components (primitives, accessibility) | `$building-components` → `$shadcn` / `$shadcn-ui` → `$vercel-composition-patterns` |
| Tailwind / design tokens | `$tailwind-design-system` / `$tailwind-v4` |
| Component API refactors | `$vercel-composition-patterns` → `$react-best-practices` |
| Forms (react-hook-form + Zod) | `$rhf-zod` → `$react-best-practices` |
| Data fetching (TanStack Query) | `$tanstack-query-v5` |
| UI design review | `$web-design-guidelines` |
| LLM features via Vercel AI SDK | `$ai-sdk` |
| Anthropic / Claude direct integration | `$claude-api` |
| Python tests | `$python-testing-patterns` |
| Async Python | `$async-python-patterns` |
| E2E testing | `$e2e-testing-patterns` |
| Azure deployment preparation | `$azure-prepare` → `$azure-validate` → `$azure-deploy` (or repo-local `$<project>-deploy`) |
| Azure production troubleshooting | `$azure-diagnostics` + `$systematic-debugging` |
| Entra / MSAL / app registration | `$entra-app-registration` → `$api-design-principles` → `$error-handling-patterns` |
| Azure AI services (OpenAI, AI Search, Document Intelligence) | `$azure-ai` |
| Logfire observability — instrument an app | `$logfire-instrumentation` (or the `logfire:instrument` skill) |
| Logfire — debug from traces | `logfire:debug` |
| Logfire — query telemetry | `$logfire-query` / `logfire:query` |
| Logfire — local dev session | `logfire:dev-session` |

When multiple skills apply, state the execution order in the prompt before doing the work. If a routed skill is not installed or not approved for the active repo, name it, fall back to the nearest available one plus the repo's rules, and continue — do not block implementation on a missing helper skill.

### 8.3 Multi-Agent Skill Sync

ATD repos may use more than one coding agent (Claude Code, Codex, Antigravity). To keep skill behavior consistent across them, treat one location as source of truth and symlink the rest. The pattern in use today:

| Agent | Personal skills path | Project skills path |
|---|---|---|
| Claude Code | `~/.claude/skills/<skill>/SKILL.md` | `.claude/skills/` |
| Codex | `~/.codex/skills/<skill>/SKILL.md` (symlink) | `.codex/skills/` |
| Antigravity | `~/.gemini/antigravity/skills/<skill>/SKILL.md` (symlink) | `.agents/skills/` |

Adding a **shared** skill (across all repos):

```bash
ln -s ~/.claude/skills/<skill-name> ~/.codex/skills/<skill-name>
ln -s ~/.claude/skills/<skill-name> ~/.gemini/antigravity/skills/<skill-name>
```

Adding a **repo-local** skill (this repo only):

```bash
ln -s ../../.claude/skills/<skill-name> .codex/skills/<skill-name>
ln -s ../../.claude/skills/<skill-name> .agents/skills/<skill-name>
```

The principle: a skill must behave the same way regardless of which agent runs it.

---

## 9. MCP and Connector Governance

MCPs and connectors are part of the delivery system. They should be treated like privileged tools.

### 9.1 General MCP Rules

- Use the project-approved connector for the target system.
- Keep access scoped to the correct workspace, project, database, or environment.
- Prefer read-only access unless the task explicitly requires mutation.
- Do not perform destructive or externally visible actions without human approval.
- Never expose secrets, raw tokens, full connection strings, or sensitive payloads in prompts, logs, docs, or PR comments.
- Record durable outcomes in the correct system: Linear for work items, GitHub for PRs, docs for decisions, observability tools for runtime evidence.

### 9.2 Linear MCP

Use for:

- Finding issue context.
- Creating scoped bugs or follow-ups.
- Moving cards through status.
- Linking PRs or summarizing implementation state.

Guardrails:

- Use only the workspace/team/project documented in the repo.
- Do not create issues in personal workspaces for team projects.
- Do not close or mark work done unless the project workflow allows it and the merge/deploy state supports it.

### 9.3 Database MCPs

Use for:

- Inspecting schemas.
- Reading non-sensitive development data.
- Validating migration effects in approved environments.
- Supporting diagnostics with least privilege.

Guardrails:

- Production write access requires explicit approval and a rollback plan.
- Prefer migrations over ad hoc schema edits.
- Do not bypass row-level security or tenant isolation for convenience.
- Do not paste sensitive query results into prompts or docs.
- If a service-role or admin credential is used, document why it was needed.

### 9.4 Observability MCPs and Logfire

Logfire (and equivalent observability tooling) connects implementation work to runtime behavior. It is the preferred ATD observability target where adopted by a project; individual repos should document their current tracing and monitoring stack in `AGENTS.md` or their runbooks.

Use for:

- Tracing request flows after deploy.
- Verifying background jobs, provider calls, and external integrations.
- Investigating production errors.
- Comparing pre-release and post-release behavior.
- Capturing evidence for incident follow-up.

Skills that operationalize this (use the ones available to the active agent):

- `$logfire-instrumentation` / `logfire:instrument` — add Logfire tracing to a Python, TS/JS, or Rust app.
- `logfire:debug` — investigate production issues from traces.
- `$logfire-query` / `logfire:query` — query telemetry interactively or add query capabilities to code.
- `logfire:dev-session` — start a local Logfire session to view traces from a running app.

Baseline expectations:

- Logs and traces include environment, service name, version or Git SHA, request or job identifier, and relevant domain identifiers (tenant, org, user, ticket, document, etc.).
- Logs do not include secrets, credentials, raw tokens, full PII payloads, or unredacted provider responses.
- PRs that add major runtime flows include observability notes: which trace/log signal confirms it works in dev?
- Incidents produce Linear follow-ups and, when useful, new tests or lessons.
- The Logfire MCP, when wired, is treated like any other MCP under §9.1 (scoped, read-by-default, no sensitive payloads in prompts).

### 9.5 GitHub and PR Connectors

Use for:

- Reading PR diffs, comments, checks, and CI results.
- Creating or updating PR descriptions when the workflow allows it.
- Investigating failed GitHub Actions.

Guardrails:

- Agents do not approve PRs.
- Agents do not merge unless explicitly authorized by a human and project policy allows it.
- CI failures should be diagnosed from logs before code changes are made.

---

## 10. CI Quality Gates

Every PR into `dev` or `main` should run a CI workflow appropriate to the stack. The exact commands live in the repository, but the quality categories are standard.

| Gate | Purpose | Examples |
|---|---|---|
| Install lockfile check | Reproducible dependencies. | `pnpm install --frozen-lockfile`, `uv sync --locked`, `npm ci`. |
| Lint | Style and common correctness issues. | ESLint, Ruff. |
| Type check | Static correctness. | `tsc --noEmit`, BasedPyright, mypy where adopted. |
| Unit tests | Core behavior. | Vitest, pytest, Jest. |
| Integration tests | Realistic module or service boundaries. | API route tests, provider mocks, DB test containers. |
| Coverage | Regression pressure on important logic. | Minimum 70%, target 85%, unless project docs state otherwise. |
| Build | Proves deployable artifact can be created. | `pnpm build`, Docker build, backend package build. |
| Migration validation | Proves database changes apply safely. | Supabase migrations, Alembic upgrade, rollback where supported. |
| Security checks | Detect dependencies, secrets, and common vulnerabilities. | CodeQL, Trivy, Dependabot, secret scanning, npm audit, pip-audit. |
| AI PR review | Automated review comments. | Claude Code review action or equivalent. |

Default local pre-PR checks:

```bash
# TypeScript / Next.js projects
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

```bash
# Python API projects
uv run ruff check .
uv run basedpyright app tests
uv run pytest tests/ -v --cov=app --cov-fail-under=70
```

The repo's `AGENTS.md` must list the actual commands. If no alias exists, use the underlying tool directly.

### 10.1 Claude Code PR Review and `@claude` Interaction

ATD's default automated AI review uses the `anthropics/claude-code-action@v1` GitHub Action triggered on `pull_request` and `issue_comment` events. Two interaction patterns:

- **Automatic review on PR open/sync.** Claude posts a structured review against the diff.
- **On-demand review via `@claude` comments.** A developer can ask follow-up questions on the PR or in a PR review comment by mentioning `@claude`, e.g.:

  ```
  @claude Is this SQL query vulnerable to injection? What about performance with large datasets?
  ```

Guardrails (see §7.1 and §9.5):

- Claude review is additive. It does not approve or merge PRs.
- The action runs with least-privilege scopes (`contents: read` or `write` only if required, `pull-requests: write`, `issues: write`, `id-token: write` only when needed).
- Use the workflow filter (`github.actor != 'claude[bot]' && github.actor != 'github-actions[bot]'`) to avoid bot-on-bot loops.

### 10.2 Reusable Workflows (Central Standards)

For organizations with several repos (ATD currently has 4–5+ active), avoid copying the same CI YAML into every repository. Recommended target state: maintain a central `airiam/github-workflows` (or equivalent org-level repo) with reusable workflows:

```
airiam/github-workflows/
└── .github/workflows/
    ├── ci-python.yml              # Reusable: lint + typecheck + tests + coverage for Python
    ├── ci-typescript.yml          # Reusable: pnpm lint + typecheck + tests + build for TS
    ├── deploy-container-app.yml   # Reusable: build-once + deploy to Azure Container Apps
    └── claude-review.yml          # Reusable: Claude Code PR review
```

Project repos call them with a few lines:

```yaml
jobs:
  ci:
    uses: airiam/github-workflows/.github/workflows/ci-python.yml@main
    with:
      python-version: "3.12"
      coverage-threshold: 70
```

Why it matters: a security check, lint rule, or Claude review model update lands in one place and every project picks it up. With 4–5+ repos, the maintenance saving is non-trivial.

---

## 11. Pull Request Standard

Every PR should answer:

- What changed?
- Why did it change?
- What Linear issue or decision does it reference?
- What was tested?
- What risks remain?
- What was intentionally deferred?
- What reviewer attention is needed?

Minimum PR template:

```markdown
## What changed

## Why

## Linear
AIR-123 or N/A

## Testing
- [ ] Local lint
- [ ] Type check
- [ ] Tests
- [ ] Build
- [ ] Manual or E2E validation

## Security / data / infra notes

## Observability
<!-- Which trace/log/metric signal confirms this works in dev?
     Skip only when the change has no runtime surface (docs, pure refactor with no behavior change). -->

## Out-of-scope follow-ups
<!-- Linear IDs for defects found during this work but intentionally not fixed here. -->

## Deferred work
```

Automated AI review is additive. A human reviewer is still required for merge.

---

## 12. Continuous Security

Security is not a final-stage checklist. It is part of planning, implementation, CI, review, and runtime operations.

Baseline controls:

- GitHub branch protection on `dev` and `main`.
- Required status checks before merge.
- Secret scanning enabled.
- Dependency vulnerability scanning enabled.
- CodeQL or equivalent static security scanning where supported.
- Container or filesystem scanning for deployable services.
- Environment protection on production.
- OIDC federation for cloud deployment wherever possible. Avoid long-lived cloud credential JSON.
- Separate secrets per environment.
- Least-privilege GitHub Actions permissions.

Security review is mandatory for:

- Authentication and authorization changes.
- Tenant or org scoping changes.
- RLS policy changes.
- Database migrations touching sensitive or shared data.
- Secrets and environment variable changes.
- Logging, telemetry, and trace payload changes.
- Webhook signature verification.
- Payment, invoice, financial, healthcare, or regulated-data flows.
- New external provider integrations.

Secrets rules:

- Never commit secrets.
- Never put real tokens in examples.
- Never log credentials or provider secrets.
- Browser-exposed environment variables must be explicitly named and documented.
- Server-only variables must never use public prefixes.
- If a secret is found in tracked code, stop and follow the project's remediation policy.

---

## 13. Testing and Coverage Standard

Default coverage policy:

| Metric | Minimum | Target |
|---|---:|---:|
| Lines | 70% | 85% |
| Branches | 70% | 85% |
| Functions | 70% | 85% |
| Statements | 70% | 85% |

Projects may enforce higher coverage for critical modules.

Prioritize tests for:

- Business rules.
- Feature orchestration.
- Provider error handling.
- API validation and error mapping.
- Auth, authorization, RLS, ACL, and tenant isolation.
- Database migrations and query scoping.
- Webhook verification and idempotency.
- Retry and recovery paths.
- Money, dates, time zones, and status transitions.
- User-visible workflows.

Do not spend excessive effort on framework boilerplate or trivial pass-through wrappers unless they protect a critical contract.

---

## 14. Deployment and Environments

The default promotion model is:

```text
feature branch
  -> PR to dev
  -> merge to dev
  -> development deployment
  -> PR dev to main
  -> staging validation
  -> production approval
  -> production deployment
```

Environment expectations:

| Environment | Purpose | Rules |
|---|---|---|
| Local | Developer and agent iteration. | Uses local env files and non-production data. |
| Development | Integrated branch validation. | Auto-deploy from `dev` when configured. |
| Staging | Production-like validation. | Deploy from `main` or release candidate. |
| Production | Customer or business runtime. | Manual approval, protected secrets, observability required. |

Deployment principles:

- Prefer infrastructure as code.
- Prefer OIDC federation over stored cloud credentials.
- Deploy immutable artifacts where possible.
- Tag artifacts with Git SHA.
- Expose health or readiness endpoint that returns service status, environment, and version or Git SHA.
- Run smoke checks after deployment.
- Make rollback explicit and tested.

Containerized projects should prefer image promotion by SHA. If a project rebuilds per environment today, document that as current state and track image promotion as a hardening item.

### 14.1 Rollback

Every production-bound service must have a rollback path that an on-call engineer can execute under stress. Two common shapes:

```bash
# Option 1: revert the merge commit on the release branch.
#   CI/CD re-deploys the reverted code through the normal pipeline.
git revert <merge-commit-sha>
git push origin main

# Option 2: redeploy a previous known-good image by SHA.
#   Works only if images are tagged by Git SHA and registry retention covers the window.
az containerapp update \
  --name <app-name> \
  --resource-group <prod-rg> \
  --image <registry>/<app-name>:<previous-good-sha>
```

Option 2 is faster but skips CI. Option 1 is slower but goes through the same gates as the original deploy. Use Option 2 only when the incident severity justifies fast rollback and the previous image is compatible with current database schema, configuration, and infrastructure state. Follow up with Option 1 or an equivalent source-control correction so the repository state and the running artifact converge.

Rollback drills (running through the procedure in a non-production environment at least once per quarter) catch image-retention gaps, IAM gaps, and runbook drift before they bite during an incident.

---

## 15. Infrastructure and Configuration Discipline

Infrastructure changes must be reviewed as carefully as application code.

Rules:

- Infrastructure-as-code is the source of truth for cloud resources.
- Environment variables required by runtime code must be documented and plumbed through local examples, CI secrets, deployment templates, and runtime configuration.
- New secrets require documented owner, environment scope, and rotation path.
- Preview or `what-if` output should be used on PRs when supported.
- Production infra changes require human approval.

Configuration plumbing checklist:

1. Application reads the setting from the approved config mechanism.
2. Local example file includes the key with placeholder value.
3. Deployment template declares the parameter or secret.
4. Environment-specific parameter files or GitHub secrets provide values.
5. Workflow exports the value where the deployment tool expects it.
6. Runbook or docs mention operational impact when relevant.
7. Smoke check confirms the deployed app sees the value.

---

## 16. Observability, Traceability, and Runbooks

Every production-bound service should answer three questions quickly:

1. What version is running?
2. Is the service healthy?
3. What happened for this request, job, ticket, document, user action, or provider call?

Baseline signals:

- Health endpoint.
- Structured application logs.
- Error tracking.
- Request traces.
- External provider call timing and failure counts.
- Deployment event history.
- CI and release history tied to Git SHA.

Logfire or equivalent tracing should be used where it provides value for:

- LLM calls and token/cost behavior.
- Retrieval and ranking flows.
- Ticket triage and Linear sync flows.
- Background jobs.
- Webhooks.
- Database-heavy operations.
- Production incident diagnosis.

Runbooks should exist for:

- Deployment.
- Rollback.
- Secret rotation.
- Database migration recovery.
- Incident triage.
- Provider outage handling.
- Environment bootstrap.

---

## 17. Lessons, Local Plans, and Continuous Improvement

ATD should treat process memory as a first-class engineering artifact.

Recommended files:

| Artifact | Purpose |
|---|---|
| `docs/devplans/<phase>-plan.md` or similar | Local project plan with stages, checklists, verification commands, blockers, and progress. |
| `docs/*roadmap*.md` | Phase sequence and blocker register. |
| `.claude/lessons/*.md` | Agent-specific lessons from repeated implementation failures and review feedback. |
| `frontend_lessons.md`, `static_type_lessons.md`, etc. | Domain-specific durable knowledge. |
| Repo-local skills | Reusable workflows that are too specific for global docs. |

Rules:

- When a lesson prevents future defects, write it down.
- When a repeated workflow emerges, convert it into a checklist, skill, or runbook.
- When a project makes an architecture decision, record it in the source-of-truth doc or decision register.
- When an incident occurs, create Linear follow-ups for tests, docs, monitoring, or architecture changes.

This is how the agent harness improves over time: failures become lessons; lessons become prompts, skills, tests, or CI gates.

---

## 18. Onboarding Checklist

Day-one project onboarding:

- [ ] Get GitHub access.
- [ ] Get Linear access.
- [ ] Get cloud portal access appropriate to role.
- [ ] Get observability access appropriate to role.
- [ ] Clone the repo.
- [ ] Read `AGENTS.md`.
- [ ] Read `CLAUDE.md` if present.
- [ ] Read architecture, roadmap, and deployment runbooks.
- [ ] Install package manager and runtime.
- [ ] Configure local env from `.env.example` or `.env.local.example`.
- [ ] Run the app locally.
- [ ] Run the local verification commands.
- [ ] Open a small PR to validate branch protection, CI, and review flow.

Agent onboarding for a repo:

- [ ] Confirm selected skills in `AGENTS.md`.
- [ ] Confirm allowed MCP connectors and scopes.
- [ ] Confirm Linear workspace, team, and project.
- [ ] Confirm CI commands.
- [ ] Confirm branch and PR target.
- [ ] Confirm deployment target and runbook.

---

## 19. What Not To Do

- Do not push directly to `dev` or `main`.
- Do not bypass CI because a change is "small".
- Do not treat automated AI review as a replacement for human approval.
- Do not use the wrong Linear workspace or personal project for team work.
- Do not make production database writes through MCP without approval and rollback plan.
- Do not commit secrets or real credentials.
- Do not add dozens of random skills to a repo just because they exist.
- Do not let agents invent architecture that conflicts with repo docs.
- Do not silently fix unrelated bugs in a scoped PR.
- Do not deploy unobservable code to production.
- Do not make Friday-afternoon production changes unless the risk of waiting is worse.

---

## 20. Leadership View: What "Good" Looks Like

A mature ATD project should be able to show:

- A clear `AGENTS.md` that an agent or new engineer can follow.
- Work traceability from Linear issue to branch, PR, CI checks, deployment, and runtime signal.
- Protected `dev` and `main` branches.
- Consistent CI gates for lint, types, tests, build, coverage, and security.
- Automated AI PR review plus mandatory human review.
- Deployment through OIDC and infrastructure as code.
- Environment-scoped secrets with no committed credentials.
- Observability that identifies running version and request/job traces.
- Project-specific skills and lessons that improve agent performance over time.
- A documented rollback path.
- A culture where process improvements become code, docs, tests, skills, or runbooks.

The desired outcome is predictable: a well-scoped issue enters the system, a reviewed and tested PR exits, deployment is observable, and every defect found along the way improves the next cycle.
