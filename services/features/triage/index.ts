/**
 * Triage Feature — owns LLM classification, deterministic priority lookup,
 * confidence flagging, and the persistence + event emission of triage results.
 *
 * Pipeline contribution (steps 3–5 of the architecture doc):
 *
 *   3. Call the AI Provider for `{ type, severity, customer_facing_summary,
 *      suggested_reply, confidence }`.
 *   4. Compute `priority = priorityForTypeSeverity(severity, type)`.
 *   5. Persist via `tickets.updateTriage` and emit `ticket_events.triaged`
 *      (or `failed` with a `triage_error`).
 *
 * The `tickets` Feature persists the raw submission and emits `received`,
 * then hands off here. The AI Provider lives at `services/providers/ai/`
 * and is called only from this module.
 */

export { priorityForTypeSeverity, priorityMatrix } from '@/services/features/triage/priorityMatrix';
export {
  CONFIDENCE_THRESHOLD,
  isLowConfidence,
} from '@/services/features/triage/confidence';
export {
  TriageClassificationSchema,
  TICKET_TYPE_VALUES,
  TICKET_SEVERITY_VALUES,
  type TriageClassification,
} from '@/services/features/triage/schemas';
export { triageTicketFeature } from '@/services/features/triage/triageTicket';
