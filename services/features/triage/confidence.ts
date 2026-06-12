/**
 * Confidence threshold for flagging LLM triage results that need human review.
 *
 * Starting value (0.70) per the Phase 2 plan. Architecture doc defers
 * calibration to a future eval set; tuning happens here, not in callers.
 *
 * `isLowConfidence` treats null / NaN as low-confidence so an LLM failure
 * that leaves the field unset surfaces as needing-human-triage rather than
 * silently passing.
 */

export const CONFIDENCE_THRESHOLD = 0.7;

export function isLowConfidence(confidence: number | null | undefined): boolean {
  if (confidence == null || Number.isNaN(confidence)) return true;
  return confidence < CONFIDENCE_THRESHOLD;
}
