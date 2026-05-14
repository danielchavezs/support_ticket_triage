import { createTicketFeature, listTicketsFeature } from '@/services/features/tickets';
import { NextResponse } from 'next/server';
import type { TicketRow } from '@/services/providers/supabase/domains/tickets';

export const runtime = 'nodejs';

// PR 2 dev defaults — these match the UUIDs seeded by
// `migrations/dev/2026-05-13_seed_dev_default.sql`. The internal-only
// dashboard and the existing client code don't yet send `orgId` / `userId`
// in their requests; the route hardcodes them here so the Provider/Feature
// rewrite stays decoupled from the request-body change.
//
// TODO(Stage P1.5 / PR 3): replace these with `process.env.DEV_DEFAULT_ORG_ID`
// (and the user equivalent) read at module init, AND require `orgId`/`userId`
// from the request body via the cryptographic caller-auth path (Phase 7
// hardens this with HMAC verification per BL-012).
const DEV_DEFAULT_ORG_ID = '00000000-0000-0000-0000-0000000000a0';
const DEV_DEFAULT_USER_ID = '00000000-0000-0000-0000-0000000000a1';

export async function GET() {
  const result = await listTicketsFeature({ orgId: DEV_DEFAULT_ORG_ID });
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 500 });
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

  const result = await createTicketFeature({
    orgId: DEV_DEFAULT_ORG_ID,
    userId: DEV_DEFAULT_USER_ID,
    subject: parsed.data.subject,
    description: parsed.data.description,
  });

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
 * Parse the legacy-shape request body. The form still sends `customerName`
 * and `email`; both are accepted but ignored in PR 2 because the new schema
 * stores those on `users`, not `tickets`. PR 3 (Stage P1.5) revisits the
 * request shape with `orgId` / `userId` instead of `customerName` / `email`.
 */
function parseTicketBody(value: Record<string, unknown>):
  | { success: true; data: { subject: string; description: string } }
  | { success: false; error: { code: string; message: string } } {
  const subject = typeof value.subject === 'string' ? value.subject : '';
  const description = typeof value.description === 'string' ? value.description : '';

  if (!subject.trim()) return { success: false, error: { code: 'VALIDATION_ERROR', message: 'Subject is required.' } };
  if (!description.trim()) return { success: false, error: { code: 'VALIDATION_ERROR', message: 'Description is required.' } };

  return { success: true, data: { subject, description } };
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
