import { NextResponse } from 'next/server';
import { retryTicketTriageFeature } from '@/services/features/tickets';
import type { TicketRow } from '@/services/providers/supabase/domains/tickets';

export const runtime = 'nodejs';

// Dev default — see app/api/tickets/route.ts for the rationale.
// TODO(Stage P1.5 / PR 3): read from env var; require in request body.
const DEV_DEFAULT_ORG_ID = '00000000-0000-0000-0000-0000000000a0';

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;

  if (!id) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Ticket ID is required' } },
      { status: 400 },
    );
  }

  // Phase 1: this is a no-op stub. It confirms the ticket exists (org-scoped)
  // and returns it unchanged. Phase 2 wires this to the triage Feature.
  const result = await retryTicketTriageFeature({
    orgId: DEV_DEFAULT_ORG_ID,
    ticketId: id,
  });

  if (!result.success) {
    const statusCode = result.error.code === 'TICKET_NOT_FOUND' ? 404 : 500;
    return NextResponse.json({ error: result.error }, { status: statusCode });
  }

  return NextResponse.json({ ticket: toTicketDto(result.data) }, { status: 200 });
}

function toTicketDto(row: TicketRow) {
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
    linearIssueId: row.linear_issue_id,
  };
}
