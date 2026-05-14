import { NextResponse } from 'next/server';
import { retryTicketTriageFeature } from '@/services/features/tickets';
import type { TicketRow } from '@/services/providers/supabase/domains/tickets';

export const runtime = 'nodejs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;

  if (!id) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Ticket ID is required.' } },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } },
      { status: 400 },
    );
  }

  if (!isRecord(body)) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Request body must be an object.' } },
      { status: 400 },
    );
  }

  const orgId = typeof body.orgId === 'string' ? body.orgId : '';
  if (!UUID_PATTERN.test(orgId)) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: '`orgId` is required and must be a UUID.' } },
      { status: 400 },
    );
  }

  const result = await retryTicketTriageFeature({ orgId, ticketId: id });

  if (!result.success) {
    const statusCode =
      result.error.code === 'TICKET_NOT_FOUND'
        ? 404
        : result.error.code === 'VALIDATION_ERROR'
          ? 400
          : 500;
    return NextResponse.json({ error: result.error }, { status: statusCode });
  }

  return NextResponse.json({ ticket: toTicketDto(result.data) }, { status: 200 });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
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
