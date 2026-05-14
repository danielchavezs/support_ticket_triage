import { describe, expect, it } from 'vitest';

import {
  priorityForTypeSeverity,
  priorityMatrix,
} from '@/services/features/triage/priorityMatrix';
import {
  TICKET_SEVERITY_VALUES,
  TICKET_TYPE_VALUES,
} from '@/services/features/triage/schemas';

const VALID_PRIORITIES = new Set(['P1', 'P2', 'P3', 'P4']);

describe('priorityMatrix (BL-001 locked)', () => {
  it('is total: every (severity, type) pair has a value', () => {
    for (const severity of TICKET_SEVERITY_VALUES) {
      for (const type of TICKET_TYPE_VALUES) {
        const value = priorityMatrix[severity][type];
        expect(value, `${severity} × ${type}`).toBeTruthy();
        expect(VALID_PRIORITIES.has(value), `${severity} × ${type} = ${value}`).toBe(true);
      }
    }
  });

  describe('priorityForTypeSeverity', () => {
    it.each([
      ['blocker', 'bug', 'P1'],
      ['blocker', 'incident', 'P1'],
      ['blocker', 'feature', 'P2'],
      ['blocker', 'improvement', 'P2'],
      ['blocker', 'question', 'P2'],
      ['major', 'bug', 'P2'],
      ['major', 'incident', 'P2'],
      ['major', 'feature', 'P2'],
      ['major', 'improvement', 'P3'],
      ['major', 'question', 'P3'],
      ['minor', 'bug', 'P3'],
      ['minor', 'feature', 'P3'],
      ['minor', 'improvement', 'P3'],
      ['minor', 'incident', 'P3'],
      ['minor', 'question', 'P4'],
      ['trivial', 'bug', 'P4'],
      ['trivial', 'feature', 'P4'],
      ['trivial', 'improvement', 'P4'],
      ['trivial', 'question', 'P4'],
      ['trivial', 'incident', 'P4'],
    ] as const)('maps (%s, %s) → %s', (severity, type, expected) => {
      expect(priorityForTypeSeverity(severity, type)).toBe(expected);
    });

    it('agrees with the raw matrix lookup for every pair', () => {
      for (const severity of TICKET_SEVERITY_VALUES) {
        for (const type of TICKET_TYPE_VALUES) {
          expect(priorityForTypeSeverity(severity, type)).toBe(priorityMatrix[severity][type]);
        }
      }
    });
  });
});
