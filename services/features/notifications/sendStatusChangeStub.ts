/**
 * Phase 5 stub for the Linear status-change notification.
 *
 * Called by `handleWebhookFeature` on every applied state transition.
 * Currently a no-op: Phase 6 will:
 *   1. Read `BL-011` (customer-relevant transition subset) and filter here.
 *   2. Render and send the status-change email via the email Provider.
 *   3. Emit `ticket_events.email_sent` on success / failure.
 *
 * The signature is intentionally Phase-6-ready so the Phase 5 call site
 * does not need to change.
 */

import type { TicketRow } from '@/services/providers/supabase/domains/tickets';

export type StatusChangeNotificationInput = {
  ticket: TicketRow;
  /** Linear state name we transitioned to (e.g., "Done"). */
  newLinearState: string;
  /** Linear state type (e.g., "completed", "started"). */
  newLinearStateType: string;
  /** Whether this transition also moved our internal status to "closed". */
  internalStatusTransitionedToClosed: boolean;
};

export async function sendStatusChangeStub(input: StatusChangeNotificationInput): Promise<void> {
  // Intentionally empty — Phase 6 fills this in. `void input` documents
  // that the contract carries data even though we don't read it yet.
  void input;
}
