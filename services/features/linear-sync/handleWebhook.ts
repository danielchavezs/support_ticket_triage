/**
 * linear-sync Feature — inbound Linear webhook handler (Phase 5).
 *
 * Receives the verified raw bytes from the route handler, runs the
 * verify+parse+dedupe+apply pipeline, and returns a `FeatureResult` the
 * route maps to HTTP. Invariants:
 *
 *   1. **Signature first.** Verification happens before idempotency,
 *      before parse, and before any side effect. A failed signature is
 *      rejected with `LINEAR_WEBHOOK_SIGNATURE_INVALID` (→ 401).
 *   2. **Idempotency via raw-body hash.** SHA-256 of the bytes is recorded
 *      in `webhook_deliveries` with a `(provider, hash)` unique constraint.
 *      Only rows marked `processed` short-circuit as duplicates; failed or
 *      incomplete rows remain retryable.
 *   3. **At-least-once friendly.** Any successful outcome — applied,
 *      duplicate, ignored, unknown_ticket — returns 200 from the route.
 *      Only signature / parse failures and unexpected provider errors
 *      surface non-2xx codes.
 *   4. **Filter is narrow.** v1 only acts on `type='Issue' && action='update'
 *      && updatedFrom.stateId != null`. Anything else is recorded for
 *      idempotency and ignored.
 *   5. **Notifications hook is a stub call.** Phase 6 fills in the body.
 *
 * Event emission and the post-update delivery-row backfill are
 * best-effort: failures log but do not roll back the ticket state update.
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';

import { fail, ok, type FeatureResult } from '@/services/features/types';
import { linear } from '@/services/providers/linear';
import { LinearWebhookSignatureError } from '@/services/providers/linear/errors';
import { server as sources } from '@/services/providers/supabase/server';
import { sendStatusChangeStub } from '@/services/features/notifications';
import type { TicketRow, TicketStatus } from '@/services/providers/supabase/domains/tickets';

export type HandleWebhookInput = {
  rawBody: Buffer;
  signatureHeader: string | null;
  timestampHeader: string | null;
};

export type StateTransition = {
  previousLinearStateId: string;
  newLinearStateId: string;
  newLinearStateName: string;
  newLinearStateType: string;
  internalStatusTransitionedToClosed: boolean;
};

export type HandleWebhookOutcome =
  | { kind: 'applied'; ticket: TicketRow; transition: StateTransition }
  | { kind: 'duplicate' }
  | { kind: 'unknown_ticket'; linearIssueId: string }
  | { kind: 'ignored'; reason: string };

const PROVIDER = 'linear';
const TERMINAL_STATE_TYPES = new Set(['completed', 'canceled']);

/**
 * Zod schema for the slice of the Linear webhook payload we actually use.
 * `passthrough` so unknown fields don't break us when Linear evolves the
 * payload — we only enforce what we read.
 */
const WebhookPayloadSchema = z
  .object({
    type: z.string(),
    action: z.string(),
    data: z
      .object({
        id: z.string(),
        state: z
          .object({
            id: z.string(),
            name: z.string(),
            type: z.string(),
          })
          .optional(),
      })
      .passthrough(),
    updatedFrom: z
      .object({
        stateId: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export async function handleWebhookFeature(
  input: HandleWebhookInput,
): Promise<FeatureResult<HandleWebhookOutcome>> {
  if (!input.signatureHeader) {
    return fail(
      'LINEAR_WEBHOOK_SIGNATURE_INVALID',
      'Missing `linear-signature` header.',
    );
  }
  if (!input.timestampHeader) {
    return fail(
      'LINEAR_WEBHOOK_SIGNATURE_INVALID',
      'Missing `linear-timestamp` header.',
    );
  }

  // Step 1: verify + parse. Signature failures dominate everything else.
  let parsedRaw: unknown;
  try {
    parsedRaw = linear.parseWebhookPayload({
      rawBody: input.rawBody,
      signature: input.signatureHeader,
      timestamp: input.timestampHeader,
    });
  } catch (err) {
    if (err instanceof LinearWebhookSignatureError) {
      return fail('LINEAR_WEBHOOK_SIGNATURE_INVALID', err.message);
    }
    return fail('LINEAR_WEBHOOK_PARSE_FAILED', errorMessage(err));
  }

  const parsed = WebhookPayloadSchema.safeParse(parsedRaw);
  if (!parsed.success) {
    return fail(
      'LINEAR_WEBHOOK_PARSE_FAILED',
      `Payload shape mismatch: ${parsed.error.issues[0]?.message ?? 'unknown error.'}`,
    );
  }
  const payload = parsed.data;

  // Step 2: idempotency. Compute the hash and try to insert.
  const deliveryHash = sha256Hex(input.rawBody);
  let alreadyDelivered = false;
  try {
    const result = await sources.webhookDeliveries.recordOrSkip({
      provider: PROVIDER,
      deliveryHash,
      eventType: payload.type,
    });
    alreadyDelivered = result.alreadyDelivered;
  } catch (err) {
    console.error('Linear webhook: idempotency record failed:', err);
    return fail('LINEAR_WEBHOOK_RECORD_FAILED', errorMessage(err));
  }
  if (alreadyDelivered) {
    return ok({ kind: 'duplicate' });
  }

  // Step 3: filter. Only Issue updates with an actual state change drive
  // ticket mutations in v1. Everything else is logged via the delivery row
  // and ignored.
  const previousStateId = payload.updatedFrom?.stateId;
  const newState = payload.data.state;
  const isStateChange =
    payload.type === 'Issue' &&
    payload.action === 'update' &&
    typeof previousStateId === 'string' &&
    !!newState;

  if (!isStateChange) {
    const completion = await markDeliveryProcessed(deliveryHash);
    if (!completion.success) return completion;
    return ok({
      kind: 'ignored',
      reason: `Payload is not an Issue state-change update (type=${payload.type}, action=${payload.action}).`,
    });
  }

  // Step 4: lookup the ticket. A null result means Linear sent us an
  // update for an issue we don't own (e.g., created directly in Linear);
  // log and 200.
  let ticket: TicketRow | null;
  try {
    ticket = await sources.tickets.findByLinearIssueId(payload.data.id);
  } catch (err) {
    console.error('Linear webhook: ticket lookup failed:', err);
    await markDeliveryFailed(deliveryHash, errorMessage(err));
    return fail('TICKET_FETCH_FAILED', errorMessage(err));
  }
  if (!ticket) {
    console.warn(
      `Linear webhook: no matching ticket for linear_issue_id=${payload.data.id} ` +
        `(state ${previousStateId} → ${newState!.id}). Returning 200; Linear should not retry.`,
    );
    const completion = await markDeliveryProcessed(deliveryHash);
    if (!completion.success) return completion;
    return ok({ kind: 'unknown_ticket', linearIssueId: payload.data.id });
  }

  // Step 5: derive the internal status transition. Terminal Linear types
  // (completed / canceled) flip our internal status to 'closed'; everything
  // else only updates linear_state.
  const status = TERMINAL_STATE_TYPES.has(newState!.type) ? ('closed' as TicketStatus) : undefined;

  let updated: TicketRow;
  try {
    updated = await sources.tickets.updateLinearState({
      orgId: ticket.org_id,
      ticketId: ticket.id,
      linearState: newState!.name,
      status,
    });
  } catch (err) {
    console.error('Linear webhook: ticket state update failed:', err);
    await markDeliveryFailed(deliveryHash, errorMessage(err));
    return fail('TICKET_UPDATE_FAILED', errorMessage(err));
  }

  // Step 6: emit `status_changed` event.
  const transition: StateTransition = {
    previousLinearStateId: previousStateId!,
    newLinearStateId: newState!.id,
    newLinearStateName: newState!.name,
    newLinearStateType: newState!.type,
    internalStatusTransitionedToClosed: status === 'closed',
  };
  try {
    await sources.ticketEvents.create({
      orgId: ticket.org_id,
      ticketId: ticket.id,
      eventType: 'status_changed',
      payload: {
        previous_linear_state_id: transition.previousLinearStateId,
        new_linear_state_id: transition.newLinearStateId,
        new_linear_state_name: transition.newLinearStateName,
        new_linear_state_type: transition.newLinearStateType,
        status_transitioned_to_closed: transition.internalStatusTransitionedToClosed,
      },
    });
  } catch (err) {
    console.error('ticket_events.status_changed emission failed (non-fatal):', err);
  }

  // Step 7: notifications stub. Phase 6 fills this in; the call site is
  // already in place.
  try {
    await sendStatusChangeStub({
      ticket: updated,
      newLinearState: transition.newLinearStateName,
      newLinearStateType: transition.newLinearStateType,
      internalStatusTransitionedToClosed: transition.internalStatusTransitionedToClosed,
    });
  } catch (err) {
    console.error('sendStatusChangeStub threw (non-fatal):', err);
  }

  const completion = await markDeliveryProcessed(deliveryHash, {
    ticketId: ticket.id,
    orgId: ticket.org_id,
  });
  if (!completion.success) return completion;

  return ok({ kind: 'applied', ticket: updated, transition });
}

async function markDeliveryProcessed(
  deliveryHash: string,
  backfill: { ticketId?: string; orgId?: string } = {},
): Promise<FeatureResult<never>> {
  try {
    await sources.webhookDeliveries.markProcessed({
      provider: PROVIDER,
      deliveryHash,
      ticketId: backfill.ticketId,
      orgId: backfill.orgId,
    });
    return ok(undefined as never);
  } catch (err) {
    console.error('Linear webhook: delivery completion update failed:', err);
    return fail('LINEAR_WEBHOOK_RECORD_FAILED', errorMessage(err));
  }
}

async function markDeliveryFailed(deliveryHash: string, message: string): Promise<void> {
  try {
    await sources.webhookDeliveries.markFailed({
      provider: PROVIDER,
      deliveryHash,
      errorMessage: message,
    });
  } catch (err) {
    console.error('Linear webhook: delivery failure marker failed:', err);
  }
}

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Unknown error.';
}
