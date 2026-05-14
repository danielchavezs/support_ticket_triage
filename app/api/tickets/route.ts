import { createTicketFeature, listTicketsFeature } from '@/services/features/tickets';
import { NextResponse } from 'next/server';
import type { TicketRow } from '@/services/providers/supabase/domains/tickets';

export const runtime = 'nodejs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const orgId = url.searchParams.get('orgId');
  if (!orgId || !UUID_PATTERN.test(orgId)) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Query parameter `orgId` is required and must be a UUID.' } },
      { status: 400 },
    );
  }

  const result = await listTicketsFeature({ orgId });
  if (!result.success) {
    const status = result.error.code === 'VALIDATION_ERROR' ? 400 : 500;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ tickets: result.data.map(toTicketDto) });
}

export async function POST(request: Request) {
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

  const parsed = parseTicketBody(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const result = await createTicketFeature(parsed.data);
  if (!result.success) {
    const status = result.error.code === 'VALIDATION_ERROR' ? 400 : 500;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ ticket: toTicketDto(result.data) }, { status: 201 });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Parse the v1 request body: `{ orgId, userId, subject, description }`.
 * Cryptographic verification of the asserted `orgId`/`userId` arrives in
 * Phase 7 (BL-012); v1 trusts the caller and only enforces shape.
 */
function parseTicketBody(value: Record<string, unknown>):
  | { success: true; data: { orgId: string; userId: string; subject: string; description: string } }
  | { success: false; error: { code: string; message: string } } {
  const orgId = typeof value.orgId === 'string' ? value.orgId : '';
  const userId = typeof value.userId === 'string' ? value.userId : '';
  const subject = typeof value.subject === 'string' ? value.subject : '';
  const description = typeof value.description === 'string' ? value.description : '';

  if (!UUID_PATTERN.test(orgId)) {
    return { success: false, error: { code: 'VALIDATION_ERROR', message: '`orgId` is required and must be a UUID.' } };
  }
  if (!UUID_PATTERN.test(userId)) {
    return { success: false, error: { code: 'VALIDATION_ERROR', message: '`userId` is required and must be a UUID.' } };
  }
  if (!subject.trim()) return { success: false, error: { code: 'VALIDATION_ERROR', message: 'Subject is required.' } };
  if (!description.trim()) return { success: false, error: { code: 'VALIDATION_ERROR', message: 'Description is required.' } };

  return { success: true, data: { orgId, userId, subject, description } };
}

/**
 * Map a v1 `TicketRow` to the camelCase DTO returned by the API. Triage
 * fields are present but null until Phase 2 wires the triage Feature.
 */
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
