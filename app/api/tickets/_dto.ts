/**
 * Shared `TicketRow → DTO` mapper for the v1 API.
 *
 * Both `GET/POST /api/tickets` and `POST /api/tickets/[id]/retry-triage`
 * return the same camelCase DTO shape, so the conversion lives in one place
 * to keep them in sync.
 *
 * Derived fields:
 *   - `needsHumanTriage` — computed from `confidence` against the threshold
 *      in `services/features/triage/confidence.ts`. Tunable without a
 *      migration since it is not stored.
 *   - `dedupStatus`      — `'duplicate'` when the row is a confirmed
 *      duplicate (`status='duplicate' && duplicate_of` set), else
 *      `'unique'`. Phase 3 ships this two-state surface; `vector_candidate`
 *      would require a `ticket_events` read per ticket which would N+1 the
 *      dashboard, so it is deferred.
 *   - `duplicateOf`      — pass-through of `duplicate_of`. The dashboard
 *      uses this to display the canonical ticket id alongside the duplicate
 *      badge.
 */

import { isLowConfidence } from '@/services/features/triage/confidence';
import type { TicketRow } from '@/services/features/tickets';

export type TicketDedupStatus = 'unique' | 'duplicate';

export type TicketDto = {
  id: string;
  createdAt: string;
  updatedAt: string;
  orgId: string;
  userId: string;
  sourceKind: TicketRow['source_kind'];
  subject: string;
  description: string;
  type: TicketRow['type'];
  severity: TicketRow['severity'];
  priority: TicketRow['priority'];
  confidence: number | null;
  customerFacingSummary: string | null;
  suggestedReply: string | null;
  status: TicketRow['status'];
  triageError: string | null;
  needsHumanTriage: boolean;
  linearIssueId: string | null;
  dedupStatus: TicketDedupStatus;
  duplicateOf: string | null;
};

export function toTicketDto(row: TicketRow): TicketDto {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    orgId: row.org_id,
    userId: row.user_id,
    sourceKind: row.source_kind,
    subject: row.subject,
    description: row.description,
    type: row.type,
    severity: row.severity,
    priority: row.priority,
    confidence: row.confidence,
    customerFacingSummary: row.customer_facing_summary,
    suggestedReply: row.suggested_reply,
    status: row.status,
    triageError: row.triage_error,
    needsHumanTriage: isLowConfidence(row.confidence),
    linearIssueId: row.linear_issue_id,
    dedupStatus: row.status === 'duplicate' && row.duplicate_of ? 'duplicate' : 'unique',
    duplicateOf: row.duplicate_of,
  };
}
