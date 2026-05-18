/**
 * Triage Feature — orchestrator for steps 3–5 of the architecture pipeline.
 *
 * Phase 3.5 wires the classification step to a bounded tool loop:
 *
 *   1. Fetch the ticket (org-scoped).
 *   2. Build the read-only tool set bound to the ticket's `org_id`,
 *      `user_id`, `subject`, `description` (see
 *      `services/features/triage/tools.ts`).
 *   3. First attempt: `ai.classifyTicketWithTools(...)` runs the bounded
 *      loop with `MAX_TOOL_ROUNDS` rounds and `TOOL_LOOP_DEADLINE_MS` wall
 *      clock budget. On success, defense-in-depth Zod re-parse the result.
 *   4. Single-shot fallback: on timeout / hard error / Zod re-parse failure
 *      on the tool-loop result, invoke the legacy `ai.classifyTicket(...)`
 *      path. The fallback uses no tools and is the same code that ran in
 *      Phases 2–3, so the pipeline always lands either `triaged` or
 *      `failed` regardless of tool-loop health.
 *   5. Compute deterministic `priority` via the locked matrix; persist via
 *      `tickets.updateTriage`; emit `ticket_events.triaged`.
 *      `payload.tool_calls` carries the per-call audit on the tool-loop
 *      path; `payload.fallback = 'single_shot'` is set on the fallback path.
 *
 * On any double-failure (both tool-loop + single-shot reject, or a final
 * Zod re-parse rejection on the single-shot result), the ticket is left in
 * a recoverable state: `status='failed'` with `triage_error` set, and a
 * `ticket_events.failed` event is emitted. The retry endpoint can re-invoke
 * this Feature to resume.
 *
 * Event emission is best-effort: a failed `ticket_events` insert logs but
 * does not roll back the triage write. The ticket row is the source of
 * truth; the event log is observability.
 */

import { fail, ok, type FeatureResult } from '@/services/features/types';
import { server as sources } from '@/services/providers/supabase/server';
import { ai } from '@/services/providers/ai';
import { TicketScopedInputSchema } from '@/services/features/tickets/schemas';
import { isLowConfidence } from '@/services/features/triage/confidence';
import {
  MAX_TOOL_ROUNDS,
  TOOL_LOOP_DEADLINE_MS,
} from '@/services/features/triage/config';
import { priorityForTypeSeverity } from '@/services/features/triage/priorityMatrix';
import {
  TriageClassificationSchema,
  type TriageClassification,
} from '@/services/features/triage/schemas';
import {
  buildTriageTools,
  summarizeSteps,
  type ToolCallAudit,
} from '@/services/features/triage/tools';
import type { TicketRow } from '@/services/providers/supabase/domains/tickets';
import type { Json } from '@/assets/databaseTypes';

type ClassifyOutcome =
  | { kind: 'tool_loop'; classification: TriageClassification; toolCalls: ToolCallAudit[] }
  | { kind: 'single_shot'; classification: TriageClassification }
  | { kind: 'failure'; message: string };

export async function triageTicketFeature(input: {
  orgId: string;
  ticketId: string;
}): Promise<FeatureResult<TicketRow>> {
  const parsed = TicketScopedInputSchema.safeParse(input);
  if (!parsed.success) {
    return fail('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid input.');
  }
  const { orgId, ticketId } = parsed.data;

  let ticket: TicketRow | null;
  try {
    ticket = await sources.tickets.getById({ orgId, ticketId });
  } catch (err) {
    console.error('Triage: ticket fetch failed:', err);
    return fail('TICKET_FETCH_FAILED', 'Failed to fetch ticket.');
  }
  if (!ticket) return fail('TICKET_NOT_FOUND', 'Ticket not found.');

  const outcome = await classify(ticket);
  if (outcome.kind === 'failure') {
    return persistFailure(orgId, ticketId, outcome.message);
  }

  const { classification } = outcome;
  const priority = priorityForTypeSeverity(classification.severity, classification.type);

  let updated: TicketRow;
  try {
    updated = await sources.tickets.updateTriage({
      orgId,
      ticketId,
      update: {
        type: classification.type,
        severity: classification.severity,
        priority,
        confidence: classification.confidence,
        customerFacingSummary: classification.customer_facing_summary,
        suggestedReply: classification.suggested_reply,
        status: 'triaged',
        triageError: null,
      },
    });
  } catch (err) {
    return persistFailure(orgId, ticketId, errorMessage(err));
  }

  const eventPayload: Record<string, Json> = {
    type: classification.type,
    severity: classification.severity,
    priority,
    confidence: classification.confidence,
    needs_human_triage: isLowConfidence(classification.confidence),
    tool_calls: outcome.kind === 'tool_loop' ? (outcome.toolCalls as unknown as Json) : ([] as unknown as Json),
  };
  if (outcome.kind === 'single_shot') {
    eventPayload.fallback = 'single_shot';
  }

  try {
    await sources.ticketEvents.create({
      orgId,
      ticketId,
      eventType: 'triaged',
      payload: eventPayload,
    });
  } catch (err) {
    console.error('ticket_events.triaged emission failed (non-fatal):', err);
  }

  return ok(updated);
}

async function classify(ticket: TicketRow): Promise<ClassifyOutcome> {
  const tools = buildTriageTools({
    ticketId: ticket.id,
    orgId: ticket.org_id,
    userId: ticket.user_id,
    subject: ticket.subject,
    description: ticket.description,
  });

  // Stage 1: bounded tool loop. On any rejection or Zod re-parse failure,
  // drop to the single-shot fallback.
  try {
    const { result, steps } = await ai.classifyTicketWithTools({
      subject: ticket.subject,
      description: ticket.description,
      schema: TriageClassificationSchema,
      tools,
      maxSteps: MAX_TOOL_ROUNDS,
      timeoutMs: TOOL_LOOP_DEADLINE_MS,
    });

    const validation = TriageClassificationSchema.safeParse(result);
    if (validation.success) {
      return {
        kind: 'tool_loop',
        classification: validation.data,
        toolCalls: summarizeSteps(steps),
      };
    }
    console.error(
      'Triage: tool-loop result failed defense-in-depth Zod re-parse; falling back to single-shot:',
      validation.error.issues[0]?.message,
    );
  } catch (err) {
    console.error('Triage: tool-loop classification failed; falling back to single-shot:', err);
  }

  // Stage 2: single-shot fallback. Same path as Phases 2–3.
  let raw: unknown;
  try {
    raw = await ai.classifyTicket({
      subject: ticket.subject,
      description: ticket.description,
      schema: TriageClassificationSchema,
    });
  } catch (err) {
    return { kind: 'failure', message: errorMessage(err) };
  }

  const validation = TriageClassificationSchema.safeParse(raw);
  if (!validation.success) {
    const issue = validation.error.issues[0]?.message ?? 'Invalid AI response shape.';
    return { kind: 'failure', message: `Schema validation failed: ${issue}` };
  }

  return { kind: 'single_shot', classification: validation.data };
}

async function persistFailure(
  orgId: string,
  ticketId: string,
  message: string,
): Promise<FeatureResult<TicketRow>> {
  console.error('Triage failed:', message);

  try {
    await sources.tickets.updateTriage({
      orgId,
      ticketId,
      update: {
        type: null,
        severity: null,
        priority: null,
        confidence: null,
        customerFacingSummary: null,
        suggestedReply: null,
        status: 'failed',
        triageError: message,
      },
    });
  } catch (err) {
    console.error('Triage: failure-state persist also failed:', err);
  }

  try {
    await sources.ticketEvents.create({
      orgId,
      ticketId,
      eventType: 'failed',
      payload: { stage: 'triage', error: message },
    });
  } catch (err) {
    console.error('ticket_events.failed emission failed (non-fatal):', err);
  }

  return fail('TRIAGE_FAILED', message);
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Unknown error.';
}
