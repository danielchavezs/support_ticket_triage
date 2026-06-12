# Airiam Customer Intake Portal: Claude Project Handoff

This package gives you everything you need to continue this work in a Claude Project (which doesn't have internet access). Follow the steps below.

---

## Step 1: Create the Claude Project

1. In Claude, click **Projects** in the sidebar.
2. Click **Create Project** (or the "+" button).
3. Name it: **Airiam Customer Intake Portal**
4. Description (optional): `Design and implementation of the customer-facing ticket intake portal that routes into Airiam's Linear workspace via AI triage. Two-tenant deployment (Airiam + Canopy).`

---

## Step 2: Paste the Project Instructions

1. In the new project, find the **Custom Instructions** or **Project Instructions** section (depending on UI version, this may be labeled "Knowledge" settings, "Instructions," or shown as a text area at the top of the project page).
2. Open the file **`PROJECT-INSTRUCTIONS.md`** from this output bundle.
3. Copy the entire contents and paste into the project instructions field.
4. Save.

This sets Claude's behavior for every conversation in this project: locked ADRs, output preferences (no em dashes, scrub Airiam from Canopy artifacts, etc.), team context, and continuity rules.

---

## Step 3: Upload the Knowledge Files

Upload all four of these files into the project's **Knowledge** section (the file-upload area within the project):

1. **`Airiam-Customer-Intake-Portal-Design-v1-1.md`**: current design doc, the load-bearing artifact
2. **`Airiam-Intake-OSS-Leverage-Analysis.md`**: open-source leverage analysis with sprint-level time savings
3. **`Airiam-Intake-Research-Findings.md`**: condensed research findings (Linear API, ITIL, Azure services, Sentry widget pattern, etc.); critical because the project has no web access
4. **`Airiam-Customer-Intake-Portal-Design-v1.md`**: superseded v1.0, kept for historical context

The order of upload doesn't matter, but make sure all four are visible in the project knowledge view before starting your first conversation.

---

## Step 4: Verify Setup with a Test Prompt

Open a new conversation in the project and paste this test prompt:

> What ADRs are in force for this project, and what's the current sprint plan?

Claude should reference the v1.1 ADRs (numbered 001 through 012) and reproduce the 7-sprint plan. If it doesn't, the knowledge files aren't being read properly; check that they uploaded successfully.

---

## Step 5: Start Your Next Conversation

Recommended starting prompts depending on what you want to do next:

### To draft the actual scaffolding (recommended next step)

> Let's draft the actual scaffolding for the intake portal. Start with the FastAPI service skeleton: the four-strategy auth resolver, the Principal model, the basic routes (POST /v1/tickets, GET /v1/tickets/{id}), and the SQLModel definitions. Real runnable code, following the standing preferences.

### To draft the embedded widget

> Let's draft the embedded widget reference implementation in Preact with Shadow DOM, mirroring the Sentry user-feedback widget architecture from the research findings. Include the init function, the form, the HMAC proxy pattern, and a usage example for embedding into a Next.js app like AR/AP or FinOps.

### To draft the Pydantic AI triage agent

> Let's draft the Pydantic AI triage agent. Use the ConfidentTriage / InsufficientContext schemas from the research findings, wire in the source-aware defaults (portal, in-app, monitoring), and include the deterministic priority calculation from the impact/urgency matrix. Production-ready code.

### To draft Bicep infrastructure

> Let's draft the Bicep modules for the per-tenant deployment. Start with the top-level main.bicep, then the modules for Web PubSub, Service Bus, Container Apps, Key Vault, and the per-tenant parameter files for Airiam and Canopy.

### To produce a Word doc for Kuk Yi review

> Convert the v1.1 design doc into a Word document suitable for Kuk Yi's review. Apply your usual formatting standards.

### To push the design through Gemini for an external review pass

> Produce a clean self-contained version of the v1.1 design doc plus the OSS leverage analysis, formatted for pasting into Gemini, with the prompt I should use to get an honest comparative assessment.

---

## Notes on Working Without Internet

The Claude Project doesn't have web search. This means:

- **Don't ask "what's the latest version of X library?"** Versions in the design docs are the working assumption; if Daniel pins something different at install time, mention it in chat and Claude will incorporate it.
- **Don't ask "is there a new feature in Linear?"** The research findings file is a snapshot from May 2026. If Linear ships something new, paste the relevant doc text into chat and Claude will work with it.
- **Don't ask Claude to verify external links.** It can't.
- **Do paste error messages, log output, code, and screenshots directly into chat.** That's the way to get help on specific problems.
- **Do reference the knowledge files explicitly** if you want Claude to ground in them: "per the research findings in the project knowledge…" or "according to ADR-005…"

If you need fresh web research at some point (for example, "did Linear change their API?"), come back to this chat (without the project) and use it like you did initially, then paste the findings into the project to update the knowledge files.

---

## Files in This Output Bundle

| File | Where It Goes |
|------|----------------|
| `PROJECT-INSTRUCTIONS.md` | Paste contents into the project's Custom Instructions field |
| `Airiam-Customer-Intake-Portal-Design-v1-1.md` | Upload to project knowledge |
| `Airiam-Intake-OSS-Leverage-Analysis.md` | Upload to project knowledge |
| `Airiam-Intake-Research-Findings.md` | Upload to project knowledge |
| `Airiam-Customer-Intake-Portal-Design-v1.md` | Upload to project knowledge (historical) |
| `HANDOFF-README.md` | This file. Keep for your records; do not upload to the project. |

---

## One Last Recommendation

Before you start the project, take 5 minutes to skim **`PROJECT-INSTRUCTIONS.md`** yourself. The "What This Saves Us" section, the standing preferences, and the locked ADRs are what give the project its character; if anything in there doesn't match how you actually want to work, edit before pasting.

Good hunting.