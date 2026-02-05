import { createTicketFeature, listTicketsFeature } from '@/services/features/tickets';
import { NextResponse } from 'next/server';
import type { TicketRow } from '@/services/sources/supabase/domains/tickets';

export const runtime = 'nodejs';

export async function GET() {
  const result = await listTicketsFeature();
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

  const parsedTicket = parseTicket(body);
  if (!parsedTicket.success) {
    return NextResponse.json({ error: parsedTicket.error }, { status: 400 });
  }

  const result = await createTicketFeature({ ticket: parsedTicket.data });
  if (!result.success) {
    const status = result.error.code === 'VALIDATION_ERROR' ? 400 : 500;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ ticket: toTicketDto(result.data) }, { status: 201 });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseTicket(value: Record<string, unknown>):
  | { success: true; data: { customerName: string; email: string; subject: string; description: string } }
  | { success: false; error: { code: string; message: string } } {
  const customerName = typeof value.customerName === 'string' ? value.customerName : '';
  const email = typeof value.email === 'string' ? value.email : '';
  const subject = typeof value.subject === 'string' ? value.subject : '';
  const description = typeof value.description === 'string' ? value.description : '';

  if (!customerName.trim()) return { success: false, error: { code: 'VALIDATION_ERROR', message: 'Customer name is required.' } };
  if (!email.trim()) return { success: false, error: { code: 'VALIDATION_ERROR', message: 'Email is required.' } };
  if (!subject.trim()) return { success: false, error: { code: 'VALIDATION_ERROR', message: 'Subject is required.' } };
  if (!description.trim()) return { success: false, error: { code: 'VALIDATION_ERROR', message: 'Description is required.' } };

  return { success: true, data: { customerName, email, subject, description } };
}

function toTicketDto(row: TicketRow) {
  return {
    id: row.id,
    createdAt: row.created_at,
    customerName: row.customer_name,
    email: row.email,
    subject: row.subject,
    description: row.description,
    priority: row.priority,
    category: row.category,
    suggestedResponse: row.suggested_response,
    triageStatus: row.triage_status,
    triageError: row.triage_error,
  };
}
