import { describe, expect, it } from 'vitest';

import { CONFIDENCE_THRESHOLD, isLowConfidence } from '@/services/features/triage/confidence';

describe('confidence threshold', () => {
  it('exports 0.70 as the starting threshold (Phase 2 lock)', () => {
    expect(CONFIDENCE_THRESHOLD).toBe(0.7);
  });

  describe('isLowConfidence', () => {
    it.each([
      [0, true],
      [0.5, true],
      [0.69, true],
      [0.6999999, true],
    ])('returns true below the threshold (%s)', (value, expected) => {
      expect(isLowConfidence(value)).toBe(expected);
    });

    it.each([
      [0.7, false],
      [0.71, false],
      [0.9, false],
      [1, false],
    ])('returns false at or above the threshold (%s)', (value, expected) => {
      expect(isLowConfidence(value)).toBe(expected);
    });

    it('treats null as low-confidence', () => {
      expect(isLowConfidence(null)).toBe(true);
    });

    it('treats undefined as low-confidence', () => {
      expect(isLowConfidence(undefined)).toBe(true);
    });

    it('treats NaN as low-confidence', () => {
      expect(isLowConfidence(Number.NaN)).toBe(true);
    });
  });
});
