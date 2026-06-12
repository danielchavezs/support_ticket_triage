/**
 * Notifications Feature — outbound email orchestration.
 *
 * Phase 5 ships only a no-op stub for the Linear status-change hook so
 * `handleWebhookFeature` has a stable seam. Phase 6 will fill in:
 *   - sendConfirmation (intake)
 *   - sendStatusChange (Linear-driven, filtered by the BL-011 subset)
 *
 * The stub is intentionally a plain async no-op rather than a "throws if
 * called in prod" guard — Phase 5 expects to call it on every applied
 * transition, and Phase 6 will replace the body without changing the
 * signature.
 */

export { sendStatusChangeStub, type StatusChangeNotificationInput } from '@/services/features/notifications/sendStatusChangeStub';
