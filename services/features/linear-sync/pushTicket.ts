/**
 * linear-sync Feature — outbound Linear push (Phase 4).
 *
 * Invoked from `createTicketFeature` after a successful triage:
 *
 *   1. Fetch the ticket (org-scoped).
 *   2. Short-circuit if `linear_issue_id` is already set (idempotency).
 *   3. Short-circuit if the ticket isn't in a pushable state (only
 *      `status='triaged'` pushes; duplicates and failed tickets do not).
 *   4. Build the Linear issue input from the ticket via `buildIssueInput`.
 *   5. Call `linear.createIssue(...)`. On rejection: emit a `failed` event
 *      with `stage='linear_push'` and return `LINEAR_PUSH_FAILED`. The
 *      ticket row stays `status='triaged'`; the retry dispatcher resumes
 *      from "triaged with no linear_issue_id."
 *   6. Persist `linear_issue_id` via `tickets.updateLinearLink`. The
 *      partial-unique index on `linear_issue_id` is the safety net against
 *      double-creation: on unique-violation, refetch and treat as success
 *      (another concurrent invocation won the race).
 *   7. Emit `ticket_events.pushed_to_linear` with `{ linear_issue_id,
 *      linear_identifier, linear_url }`.
 *
 * Errors are normalized to `FeatureError`. The transient-vs-fatal
 * distinction is intentionally light in v1: every Linear failure is
 * surfaced as `LINEAR_PUSH_FAILED` and the retry endpoint is the recovery
 * path. Phase 4 does not attempt automatic in-line retry.
 */

import { fail, ok, type FeatureResult } from '@/services/features/types';
import { server as sources } from '@/services/providers/supabase/server';
import { linear } from '@/services/providers/linear';
import { getLinearTeamId } from '@/services/providers/linear/client';
import { TicketScopedInputSchema } from '@/services/features/tickets/schemas';
import type { TicketRow, TicketPriority } from '@/services/providers/supabase/domains/tickets';

export type LinearPushOutcome = {
  ticket: TicketRow;
  /**
   * - `pushed`:    a brand-new Linear issue was created in this call.
   * - `already_linked`: the ticket already had `linear_issue_id`; no-op.
   * - `skipped`:   the ticket is not in a pushable state (`duplicate`,
   *                `failed`, `received`); no-op.
   */
  kind: 'pushed' | 'already_linked' | 'skipped';
};

const PUSHABLE_STATUS: TicketRow['status'] = 'triaged';

const PRIORITY_TO_LINEAR: Record<TicketPriority, 1 | 2 | 3 | 4> = {
  P1: 1, // Urgent
  P2: 2, // High
  P3: 3, // Medium
  P4: 4, // Low
};

export type LinearIssueDraft = {
  teamId: string;
  title: string;
  description: string;
  priority: 1 | 2 | 3 | 4;
};

/**
 * Pure mapper from a triaged ticket row to Linear's `IssueCreateInput`.
 *
 * Throws when the ticket lacks fields the matrix should have populated
 * (priority, customer-facing summary). Those throws are defense in depth:
 * `pushTicketToLinearFeature` won't call this on a non-triaged ticket, so
 * the only way to land here without those fields is a programming bug
 * upstream.
 */
export function buildIssueInput(ticket: TicketRow, teamId: string): LinearIssueDraft {
  if (!ticket.priority) {
    throw new Error(
      `Ticket ${ticket.id} has no priority — expected matrix-derived P1..P4 by the time the push runs.`,
    );
  }
  return {
    teamId,
    title: ticket.subject,
    description: buildIssueBody(ticket),
    priority: PRIORITY_TO_LINEAR[ticket.priority],
  };
}

function buildIssueBody(ticket: TicketRow): string {
  const summary = ticket.customer_facing_summary?.trim() ?? '';
  const summaryBlock = summary ? `${summary}\n\n---\n\n` : '';

  // Footer carries the audit / classification metadata so operators in
  // Linear can see how the triage decision landed without round-tripping
  // back to our DB. PII (raw description) lives above the rule; the
  // footer is metadata only.
  const footerLines: string[] = [
    `**Type:** ${ticket.type ?? 'unknown'}`,
    `**Severity:** ${ticket.severity ?? 'unknown'}`,
    `**Confidence:** ${ticket.confidence != null ? ticket.confidence.toFixed(2) : 'unknown'}`,
    `**Source:** ${ticket.source_kind}`,
    `**Ticket ID:** \`${ticket.id}\``,
    `**Org ID:** \`${ticket.org_id}\``,
    `**User ID:** \`${ticket.user_id}\``,
  ];
  if (ticket.dedup_signature) {
    footerLines.push(`**Dedup signature:** \`${ticket.dedup_signature.slice(0, 8)}…\``);
  }

  const suggestedReply = ticket.suggested_reply?.trim();
  const suggestedReplyBlock = suggestedReply
    ? `\n\n---\n\n**Suggested reply (draft, not sent):**\n\n> ${suggestedReply.replace(/\n/g, '\n> ')}`
    : '';

  return `${summaryBlock}${ticket.description}\n\n---\n\n${footerLines.join('  \n')}${suggestedReplyBlock}`;
}

export async function pushTicketToLinearFeature(input: {
  orgId: string;
  ticketId: string;
}): Promise<FeatureResult<LinearPushOutcome>> {
  const parsed = TicketScopedInputSchema.safeParse(input);
  if (!parsed.success) {
    return fail('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid input.');
  }
  const { orgId, ticketId } = parsed.data;

  let ticket: TicketRow | null;
  try {
    ticket = await sources.tickets.getById({ orgId, ticketId });
  } catch (err) {
    console.error('Linear push: ticket fetch failed:', err);
    return fail('TICKET_FETCH_FAILED', 'Failed to fetch ticket.');
  }
  if (!ticket) return fail('TICKET_NOT_FOUND', 'Ticket not found.');

  if (ticket.linear_issue_id) {
    return ok({ ticket, kind: 'already_linked' });
  }
  if (ticket.status !== PUSHABLE_STATUS) {
    return ok({ ticket, kind: 'skipped' });
  }

  let teamId: string;
  try {
    teamId = getLinearTeamId();
  } catch (err) {
    return fail('LINEAR_CONFIG_MISSING', errorMessage(err));
  }

  let draft: LinearIssueDraft;
  try {
    draft = buildIssueInput(ticket, teamId);
  } catch (err) {
    return fail('VALIDATION_ERROR', errorMessage(err));
  }

  let created: Awaited<ReturnType<typeof linear.createIssue>>;
  try {
    created = await linear.createIssue(draft);
  } catch (err) {
    const message = errorMessage(err);
    console.error('Linear push: createIssue failed:', message);
    await emitFailedEvent(orgId, ticketId, message);
    return fail('LINEAR_PUSH_FAILED', message);
  }

  // Persist the linkage. The partial-unique index on `linear_issue_id`
  // is the canonical idempotency guarantee — a second concurrent invocation
  // for the same ticket would fail here, and we treat that as success
  // (the row already carries a Linear ID).
  let updated: TicketRow;
  try {
    updated = await sources.tickets.updateLinearLink({
      orgId,
      ticketId,
      linearIssueId: created.issueId,
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      // A concurrent push won the race. Refetch to surface the current
      // (Linear-linked) state to the caller; treat as success.
      try {
        const refetched = await sources.tickets.getById({ orgId, ticketId });
        if (refetched && refetched.linear_issue_id) {
          return ok({ ticket: refetched, kind: 'already_linked' });
        }
      } catch (refetchErr) {
        console.error('Linear push: refetch after unique-violation failed:', refetchErr);
      }
    }
    const message = errorMessage(err);
    console.error('Linear push: persist failed:', message);
    await emitFailedEvent(orgId, ticketId, message);
    return fail('LINEAR_PERSIST_FAILED', message);
  }

  try {
    await sources.ticketEvents.create({
      orgId,
      ticketId,
      eventType: 'pushed_to_linear',
      payload: {
        linear_issue_id: created.issueId,
        linear_identifier: created.identifier,
        linear_url: created.url,
      },
    });
  } catch (err) {
    console.error('ticket_events.pushed_to_linear emission failed (non-fatal):', err);
  }

  return ok({ ticket: updated, kind: 'pushed' });
}

async function emitFailedEvent(orgId: string, ticketId: string, message: string) {
  try {
    await sources.ticketEvents.create({
      orgId,
      ticketId,
      eventType: 'failed',
      payload: { stage: 'linear_push', error: message },
    });
  } catch (err) {
    console.error('ticket_events.failed (linear_push) emission failed (non-fatal):', err);
  }
}

function isUniqueViolation(err: unknown): boolean {
  // Postgres unique_violation code is `23505`; supabase-js surfaces it on
  // the error object as `code`.
  if (err && typeof err === 'object' && 'code' in err) {
    return (err as { code?: string }).code === '23505';
  }
  return false;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Unknown error.';
}
