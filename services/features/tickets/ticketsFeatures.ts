/**
 * Tickets Feature — business orchestration for ticket CRUD-ish operations.
 *
 * Phase 1 scope: create, list, get, and a no-op retry stub. The LLM-driven
 * triage call is deliberately absent in Phase 1; Phase 2's triage Feature
 * will own classification + customer reply drafting and update the row via
 * `tickets.updateTriage`. Tickets in Phase 1 persist with `status='received'`
 * and every triage field null.
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
 * Retry triage stub.
 *
 * Phase 1 has no triage logic — Phase 2 wires this up to invoke the triage
 * Feature. For now, this confirms the ticket exists (org-scoped) and returns
 * it unchanged with a 200-equivalent. Callers see a non-error response so
 * the existing UI's retry button continues to behave non-disastrously,
 * even though it has no useful effect yet.
 *
 * TODO(Phase 2): replace the no-op with a call to
 * `services/features/triage/runTriage` (or equivalent entry point).
 */
export async function retryTicketTriageFeature(input: {
  orgId: string;
  ticketId: string;
}): Promise<FeatureResult<TicketRow>> {
  return getTicketFeature(input);
}
