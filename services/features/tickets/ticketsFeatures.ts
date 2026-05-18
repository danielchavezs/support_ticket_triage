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
import { dedupTicketFeature } from '@/services/features/dedup/dedupTicket';
import { pushTicketToLinearFeature } from '@/services/features/linear-sync/pushTicket';
import type { TicketRow } from '@/services/providers/supabase/domains/tickets';

export type { NewTicketInput } from '@/services/features/tickets/schemas';
export type { TicketRow } from '@/services/providers/supabase/domains/tickets';

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

  // Inline dedup (step 2 of the architecture pipeline; Phase 3). A
  // deterministic hit hard-links the ticket and short-circuits triage.
  // Vector hits and no-hits fall through to triage. Dedup-feature errors
  // are logged and the pipeline continues — same precedent as Phase 2's
  // treatment of `received` event emission: ticket existence + classification
  // is more important than dedup, which is recoverable via the retry path.
  const dedup = await dedupTicketFeature({
    orgId: created.org_id,
    ticketId: created.id,
    subject: parsed.data.subject,
    description: parsed.data.description,
  });

  if (dedup.success && dedup.data.kind === 'deterministic_hit') {
    // Row has been updated to `status='duplicate'` with `duplicate_of` set.
    // Re-read to return the post-dedup state to the caller. Fall back to the
    // created row if the refetch fails (best-effort, matches the post-triage
    // fallback below).
    try {
      const current = await sources.tickets.getById({ orgId: created.org_id, ticketId: created.id });
      if (current) return ok(current);
    } catch (err) {
      console.error('ticket fetch after dedup hit failed (non-fatal):', err);
    }
    return ok(created);
  }

  if (!dedup.success) {
    console.error(
      `Dedup failed (continuing to triage): ${dedup.error.code} ${dedup.error.message}`,
    );
  }

  // Inline triage (steps 3–5 of the architecture pipeline). A failure here
  // leaves the ticket with `status='failed'` and `triage_error` set — the
  // ticket itself is still created successfully, so the API returns 201.
  // The retry endpoint can resume the failed ticket later.
  const triage = await triageTicketFeature({ orgId: created.org_id, ticketId: created.id });

  // Inline Linear push (step 6, Phase 4). Runs only when triage succeeded
  // and produced a `triaged` row. Linear errors do NOT roll back triage —
  // the row stays `triaged` with `linear_issue_id IS NULL` and the retry
  // dispatcher resumes from that gap. We return whichever row state is
  // most up-to-date.
  if (triage.success && triage.data.status === 'triaged') {
    const push = await pushTicketToLinearFeature({
      orgId: triage.data.org_id,
      ticketId: triage.data.id,
    });
    if (push.success) return ok(push.data.ticket);
    console.error(
      `Linear push failed (recoverable via retry): ${push.error.code} ${push.error.message}`,
    );
    return ok(triage.data);
  }

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
 * Dispatch order (top branch wins):
 *   1. `status='duplicate'`               → if the canonical ticket is gone,
 *                                            clear `duplicate_of` + reset
 *                                            `status='received'`, then re-run
 *                                            dedup. If the canonical is still
 *                                            present, no-op (idempotent).
 *   2. `dedup_signature IS NULL`          → re-run dedup. Covers the case
 *      AND `status='received'`             where create-time dedup hit a
 *                                            transient error and was logged-
 *                                            and-skipped.
 *   3. `type IS NULL` OR `status='failed'` → re-run triage. Phase 2 semantics
 *                                            preserved. On success, fall
 *                                            through to the Linear-push
 *                                            branch below so the freshly
 *                                            triaged ticket also lands in
 *                                            Linear in the same call.
 *   4. `status='triaged'`                  → re-run Linear push. Phase 4:
 *      AND `linear_issue_id IS NULL`        covers the case where Linear was
 *                                            briefly unavailable at create
 *                                            time and the push was skipped.
 *   5. Anything else                       → idempotent no-op.
 *
 * Why the order matters: a stale-duplicate state must be cleared before any
 * dedup/triage re-run runs, otherwise the dispatcher would see `status='duplicate'`
 * and treat it as a no-op forever. Linear push runs last because it depends
 * on the triage result.
 */
export async function retryTicketTriageFeature(input: {
  orgId: string;
  ticketId: string;
}): Promise<FeatureResult<TicketRow>> {
  const fetched = await getTicketFeature(input);
  if (!fetched.success) return fetched;

  let ticket = fetched.data;

  // Branch 1: stale-duplicate recovery.
  if (ticket.status === 'duplicate' && ticket.duplicate_of) {
    let canonical: TicketRow | null = null;
    try {
      canonical = await sources.tickets.getById({
        orgId: ticket.org_id,
        ticketId: ticket.duplicate_of,
      });
    } catch (err) {
      console.error('Retry: canonical fetch failed (treating as missing):', err);
    }

    if (canonical) {
      // Canonical still here — duplicate state is correct, nothing to retry.
      return ok(ticket);
    }

    // Canonical missing: clear the duplicate linkage so the next branches
    // can run on a clean `status='received'` row.
    try {
      ticket = await sources.tickets.updateDedupState({
        orgId: ticket.org_id,
        ticketId: ticket.id,
        update: { duplicateOf: null, status: 'received' },
      });
    } catch (err) {
      return fail(
        'DEDUP_PERSIST_FAILED',
        err instanceof Error ? err.message : 'Failed to clear stale duplicate state.',
      );
    }
  }

  // Branch 2: re-dedup when signature is missing on a received row.
  if (ticket.status === 'received' && ticket.dedup_signature == null) {
    const dedup = await dedupTicketFeature({
      orgId: ticket.org_id,
      ticketId: ticket.id,
      subject: ticket.subject,
      description: ticket.description,
    });

    if (dedup.success && dedup.data.kind === 'deterministic_hit') {
      // Row now `status='duplicate'`; re-read to return that state.
      const refetched = await sources.tickets.getById({
        orgId: ticket.org_id,
        ticketId: ticket.id,
      });
      return ok(refetched ?? ticket);
    }

    if (!dedup.success) {
      console.error(
        `Retry: dedup re-run failed (continuing to triage): ${dedup.error.code} ${dedup.error.message}`,
      );
    } else {
      // Vector hit or no_hit: refetch to pick up any signature/embedding the
      // dedup orchestrator persisted before the triage branch evaluates.
      try {
        const refetched = await sources.tickets.getById({
          orgId: ticket.org_id,
          ticketId: ticket.id,
        });
        if (refetched) ticket = refetched;
      } catch (err) {
        console.error('Retry: refetch after dedup failed (non-fatal):', err);
      }
    }
  }

  // Branch 3: triage retry (Phase 2 semantics). On success, fall through to
  // branch 4 so the Linear push happens in the same retry call when the
  // ticket newly reaches `triaged` state.
  if (ticket.type == null || ticket.status === 'failed') {
    const triage = await triageTicketFeature({ orgId: ticket.org_id, ticketId: ticket.id });
    if (!triage.success) return triage;
    ticket = triage.data;
  }

  // Branch 4: Linear-push retry (Phase 4). Covers the case where the
  // outbound push hit a transient failure at create time.
  if (ticket.status === 'triaged' && ticket.linear_issue_id == null) {
    const push = await pushTicketToLinearFeature({
      orgId: ticket.org_id,
      ticketId: ticket.id,
    });
    if (!push.success) {
      // Stay recoverable: surface the ticket's current row state to the
      // caller, but report the push failure code so operators can act.
      return push;
    }
    return ok(push.data.ticket);
  }

  // Branch 5: idempotent no-op.
  return ok(ticket);
}
