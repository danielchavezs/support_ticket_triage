/**
 * Deterministic priority matrix — the table that converts the LLM-produced
 * `(severity, type)` pair into a `priority` (P1..P4). Locked 2026-05-13
 * via BL-001 (see `docs/DC/airiam-ticket-triage-roadmap.md` § Decision
 * Blockers Register).
 *
 * Phase 2 will wire `priorityForTypeSeverity` into the triage Feature as
 * step 4 of the pipeline. Phase 1 ships the matrix + lookup so the data
 * is canonical in one place, but no Feature calls it yet.
 *
 * Mapping:
 *   P1 = Critical, P2 = High, P3 = Medium, P4 = Low.
 *
 * The matrix is total: every `(severity, type)` pair has a value. This
 * avoids null priorities and removes the need for fallback logic.
 */

import type {
  TicketPriority,
  TicketSeverity,
  TicketType,
} from '@/services/providers/supabase/domains/tickets';

export const priorityMatrix: Record<TicketSeverity, Record<TicketType, TicketPriority>> = {
  blocker: {
    bug: 'P1',
    feature: 'P2',
    improvement: 'P2',
    question: 'P2',
    incident: 'P1',
  },
  major: {
    bug: 'P2',
    feature: 'P2',
    improvement: 'P3',
    question: 'P3',
    incident: 'P2',
  },
  minor: {
    bug: 'P3',
    feature: 'P3',
    improvement: 'P3',
    question: 'P4',
    incident: 'P3',
  },
  trivial: {
    bug: 'P4',
    feature: 'P4',
    improvement: 'P4',
    question: 'P4',
    incident: 'P4',
  },
};

export function priorityForTypeSeverity(severity: TicketSeverity, type: TicketType): TicketPriority {
  return priorityMatrix[severity][type];
}
