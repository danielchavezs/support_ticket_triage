/**
 * Triage Feature — orchestrator for steps 3–5 of the architecture pipeline.
 *
 * Responsibilities:
 *   1. Fetch the ticket (org-scoped).
 *   2. Call the AI Provider for classification.
 *   3. Re-parse the result with Zod (defense-in-depth against any future
 *      Provider that doesn't enforce the schema upstream).
 *   4. Compute deterministic `priority` via the locked matrix.
 *   5. Persist via `tickets.updateTriage` and emit `ticket_events.triaged`.
 *
 * On any failure (AI error, schema mismatch, DB write), the ticket is left
 * in a recoverable state: `status='failed'` with `triage_error` set, and a
 * `ticket_events.failed` event is emitted. The caller (`tickets.retry`)
 * can re-invoke this Feature to resume.
 *
 * Event emission is best-effort: a failed `ticket_events` insert logs but
 * does not roll back the triage write. The ticket row state is the source
 * of truth; the event log is observability.
 */

import { fail, ok, type FeatureResult } from '@/services/features/types';
import { server as sources } from '@/services/providers/supabase/server';
import { ai } from '@/services/providers/ai';
import { TicketScopedInputSchema } from '@/services/features/tickets/schemas';
import { isLowConfidence } from '@/services/features/triage/confidence';
import { priorityForTypeSeverity } from '@/services/features/triage/priorityMatrix';
import { TriageClassificationSchema } from '@/services/features/triage/schemas';
import type { TicketRow } from '@/services/providers/supabase/domains/tickets';

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

  let raw: unknown;
  try {
    raw = await ai.classifyTicket({
      subject: ticket.subject,
      description: ticket.description,
      schema: TriageClassificationSchema,
    });
  } catch (err) {
    return persistFailure(orgId, ticketId, errorMessage(err));
  }

  const validation = TriageClassificationSchema.safeParse(raw);
  if (!validation.success) {
    const issue = validation.error.issues[0]?.message ?? 'Invalid AI response shape.';
    return persistFailure(orgId, ticketId, `Schema validation failed: ${issue}`);
  }
  const classification = validation.data;

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

  try {
    await sources.ticketEvents.create({
      orgId,
      ticketId,
      eventType: 'triaged',
      payload: {
        type: classification.type,
        severity: classification.severity,
        priority,
        confidence: classification.confidence,
        needs_human_triage: isLowConfidence(classification.confidence),
      },
    });
  } catch (err) {
    console.error('ticket_events.triaged emission failed (non-fatal):', err);
  }

  return ok(updated);
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
