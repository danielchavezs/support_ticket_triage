/**
 * Tickets Feature — business orchestration for ticket CRUD-ish operations.
 *
 * Phase 2 scope: create + list + get + state-aware retry. Triage itself
 * lives in `services/features/triage/`; this Feature owns persistence and
 * the `received` event, then hands off to `triageTicketFeature` inline
 * after insert. If triage fails, the ticket still exists (recoverable
 * `status='failed'` state) and is returned to the caller; the retry
 * endpoint can resume it.
 *
 * Org-scoping invariant: every entry point requires `orgId` (and where
 * applicable `userId`). The Feature relies on the Provider to apply the
 * `org_id` predicate to every query; this Feature does NOT silently fall
 * back to a default org.
 *
 * Event emission: every successful insert emits `ticket_events.received`
 * via the `ticketEvents` Provider. Emission failures log but do not roll
 * back the ticket — the ticket existing is more important than the audit
 * event being recorded.
 */

import { fail, ok, type FeatureResult } from '@/services/features/types';
import { server as sources } from '@/services/providers/supabase/server';
import {
  NewTicketInputSchema,
  OrgScopedInputSchema,
  TicketScopedInputSchema,
  type NewTicketInput,
} from '@/services/features/tickets/schemas';
import { triageTicketFeature } from '@/services/features/triage/triageTicket';
import type { TicketRow } from '@/services/providers/supabase/domains/tickets';

export type { NewTicketInput } from '@/services/features/tickets/schemas';

export async function listTicketsFeature(input: { orgId: string }): Promise<FeatureResult<TicketRow[]>> {
  const parsed = OrgScopedInputSchema.safeParse(input);
  if (!parsed.success) {
    return fail('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid input.');
  }

  try {
    const tickets = await sources.tickets.list({ orgId: parsed.data.orgId });
    return ok(tickets);
  } catch (err) {
    console.error('Tickets list failed:', err);
    return fail('TICKETS_LIST_FAILED', 'Failed to fetch tickets.');
  }
}

export async function createTicketFeature(input: NewTicketInput): Promise<FeatureResult<TicketRow>> {
  const parsed = NewTicketInputSchema.safeParse(input);
  if (!parsed.success) {
    return fail('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid input.');
  }

  let created: TicketRow;
  try {
    created = await sources.tickets.create({
      orgId: parsed.data.orgId,
      userId: parsed.data.userId,
      subject: parsed.data.subject,
      description: parsed.data.description,
      sourceKind: parsed.data.sourceKind,
    });
  } catch (err) {
    console.error('Ticket create failed:', err);
    return fail('TICKET_CREATE_FAILED', 'Failed to create ticket.');
  }

  // Emit `received` event. Best-effort: a failed emission does not roll back
  // the ticket because the ticket existing is the more important invariant.
  try {
    await sources.ticketEvents.create({
      orgId: created.org_id,
      ticketId: created.id,
      eventType: 'received',
    });
  } catch (err) {
    console.error('ticket_events.received emission failed (non-fatal):', err);
  }

  // Inline triage (steps 3–5 of the architecture pipeline). A failure here
  // leaves the ticket with `status='failed'` and `triage_error` set — the
  // ticket itself is still created successfully, so the API returns 201.
  // The retry endpoint can resume the failed ticket later.
  const triage = await triageTicketFeature({ orgId: created.org_id, ticketId: created.id });
  if (triage.success) return ok(triage.data);

  try {
    const current = await sources.tickets.getById({ orgId: created.org_id, ticketId: created.id });
    if (current) return ok(current);
  } catch (err) {
    console.error('ticket fetch after triage failure failed (non-fatal):', err);
  }

  return ok(created);
}

export async function getTicketFeature(input: {
  orgId: string;
  ticketId: string;
}): Promise<FeatureResult<TicketRow>> {
  const parsed = TicketScopedInputSchema.safeParse(input);
  if (!parsed.success) {
    return fail('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid input.');
  }

  let ticket: TicketRow | null;
  try {
    ticket = await sources.tickets.getById({ orgId: parsed.data.orgId, ticketId: parsed.data.ticketId });
  } catch (err) {
    console.error('Ticket fetch failed:', err);
    return fail('TICKET_FETCH_FAILED', 'Failed to fetch ticket.');
  }

  if (!ticket) return fail('TICKET_NOT_FOUND', 'Ticket not found.');
  return ok(ticket);
}

/**
 * State-aware retry dispatcher.
 *
 * Phase 2 only knows about the triage stage. If the ticket is still
 * un-classified (`type IS NULL`) or in `status='failed'`, re-run triage.
 * Otherwise treat retry as an idempotent no-op and return the ticket.
 *
 * Phase 3+ will extend this dispatch table — e.g. dedup re-run when the
 * ticket reached `duplicate` state with a stale signature, Linear push
 * re-run when `linear_issue_id IS NULL` after a triaged ticket. The
 * function lives in the `tickets` Feature because retry is a
 * tickets-scoped recovery action, not a triage-internal concern.
 */
export async function retryTicketTriageFeature(input: {
  orgId: string;
  ticketId: string;
}): Promise<FeatureResult<TicketRow>> {
  const fetched = await getTicketFeature(input);
  if (!fetched.success) return fetched;

  const ticket = fetched.data;
  if (ticket.type == null || ticket.status === 'failed') {
    return triageTicketFeature({ orgId: ticket.org_id, ticketId: ticket.id });
  }

  return ok(ticket);
}
