/**
 * Triage Feature — scaffolding only in Phase 1.
 *
 * Phase 2 will populate this module with the triage orchestration:
 *
 *   1. Receive the persisted ticket from the create flow.
 *   2. Call the (re-)built LLM Provider for classification:
 *        { type, severity, customer_facing_summary, suggested_reply, confidence }
 *   3. Validate the LLM output with Zod.
 *   4. Compute `priority = priorityForTypeSeverity(severity, type)`.
 *   5. Persist via `tickets.updateTriage` and emit `ticket_events.triaged`
 *      (or `failed` with a `triage_error`).
 *
 * The only thing Phase 1 lands is `priorityForTypeSeverity` (see
 * `priorityMatrix.ts`) so the BL-001 decision lives in one canonical place.
 */

export { priorityForTypeSeverity, priorityMatrix } from '@/services/features/triage/priorityMatrix';
