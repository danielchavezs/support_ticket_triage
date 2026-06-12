import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockedFunction } from 'vitest';

import { POST } from '@/app/api/tickets/[id]/retry-triage/route';
import { retryTicketTriageFeature } from '@/services/features/tickets';
import type { TicketRow } from '@/services/providers/supabase/domains/tickets';

vi.mock('@/services/features/tickets', () => ({
  retryTicketTriageFeature: vi.fn(),
}));

vi.mock('next/server', () => ({
  NextResponse: {
    json: vi.fn((data, init) => ({
      json: async () => data,
      status: init?.status ?? 200,
    })),
  },
}));

const ORG_A = '00000000-0000-0000-0000-0000000000a0';
const USER_A = '00000000-0000-0000-0000-0000000000a1';
const TICKET_ID = '00000000-0000-0000-0000-0000000000c1';

describe('POST /api/tickets/[id]/retry-triage', () => {
  const retryMock = retryTicketTriageFeature as unknown as MockedFunction<typeof retryTicketTriageFeature>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy?.mockRestore();
    consoleErrorSpy = null;
  });

  function callRoute(
    id: string,
    body: unknown = { orgId: ORG_A },
    bodyKind: 'json' | 'invalid' = 'json',
  ) {
    const request = {
      json: bodyKind === 'invalid' ? () => Promise.reject(new Error('SyntaxError')) : async () => body,
    } as Request;
    return POST(request, { params: Promise.resolve({ id }) }) as Promise<{
      json: () => Promise<unknown>;
      status: number;
    }>;
  }

  it('returns 200 with the Feature\'s ticket (no-op on already-triaged)', async () => {
    const ticket = makeTicketRow({ id: TICKET_ID, status: 'triaged', confidence: 0.9 });
    retryMock.mockResolvedValue({ success: true, data: ticket });

    const response = await callRoute(TICKET_ID);
    const json = (await response.json()) as {
      ticket: { id: string; status: string; needsHumanTriage: boolean };
    };

    expect(retryMock).toHaveBeenCalledWith({ orgId: ORG_A, ticketId: TICKET_ID });
    expect(response.status).toBe(200);
    expect(json.ticket.id).toBe(TICKET_ID);
    expect(json.ticket.status).toBe('triaged');
    expect(json.ticket.needsHumanTriage).toBe(false);
  });

  it('returns 200 with a re-triaged ticket after retry', async () => {
    const triaged = makeTicketRow({ id: TICKET_ID, status: 'triaged', type: 'bug', priority: 'P2', confidence: 0.4 });
    retryMock.mockResolvedValue({ success: true, data: triaged });

    const response = await callRoute(TICKET_ID);
    const json = (await response.json()) as {
      ticket: { status: string; priority: string; needsHumanTriage: boolean };
    };

    expect(response.status).toBe(200);
    expect(json.ticket.priority).toBe('P2');
    // Confidence 0.4 < 0.70 threshold → flagged for human review.
    expect(json.ticket.needsHumanTriage).toBe(true);
  });

  it('returns 500 when retry returns TRIAGE_FAILED', async () => {
    retryMock.mockResolvedValue({
      success: false,
      error: { code: 'TRIAGE_FAILED', message: 'Gemini 503' },
    });

    const response = await callRoute(TICKET_ID);
    expect(response.status).toBe(500);
  });

  it('returns 400 when no ticket id is supplied', async () => {
    const response = await callRoute('');
    expect(response.status).toBe(400);
    expect(retryMock).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid JSON body', async () => {
    const response = await callRoute(TICKET_ID, undefined, 'invalid');
    expect(response.status).toBe(400);
    expect(retryMock).not.toHaveBeenCalled();
  });

  it('returns 400 when body is not a JSON object', async () => {
    const response = await callRoute(TICKET_ID, [ORG_A]);
    expect(response.status).toBe(400);
    expect(retryMock).not.toHaveBeenCalled();
  });

  it.each([
    ['orgId missing', {}],
    ['orgId not a UUID', { orgId: 'not-a-uuid' }],
  ])('returns 400 when %s', async (_label, body) => {
    const response = await callRoute(TICKET_ID, body);
    expect(response.status).toBe(400);
    expect(retryMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the Feature reports TICKET_NOT_FOUND', async () => {
    retryMock.mockResolvedValue({
      success: false,
      error: { code: 'TICKET_NOT_FOUND', message: 'Not found.' },
    });

    const response = await callRoute(TICKET_ID);
    expect(response.status).toBe(404);
  });

  it('returns 400 when the Feature reports VALIDATION_ERROR', async () => {
    retryMock.mockResolvedValue({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Bad input.' },
    });

    const response = await callRoute(TICKET_ID);
    expect(response.status).toBe(400);
  });

  it('returns 500 on other Feature errors', async () => {
    retryMock.mockResolvedValue({
      success: false,
      error: { code: 'TICKET_FETCH_FAILED', message: 'DB down.' },
    });

    const response = await callRoute(TICKET_ID);
    expect(response.status).toBe(500);
  });
});

function makeTicketRow(overrides: Partial<TicketRow> = {}): TicketRow {
  return {
    id: '00000000-0000-0000-0000-000000000000',
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    deleted_at: null,
    org_id: ORG_A,
    user_id: USER_A,
    source_kind: 'in_app',
    subject: 'Subject',
    description: 'Description',
    type: null,
    severity: null,
    priority: null,
    confidence: null,
    customer_facing_summary: null,
    suggested_reply: null,
    status: 'received',
    triage_error: null,
    dedup_signature: null,
    duplicate_of: null,
    linear_issue_id: null,
    linear_state: null,
    description_embedding: null,
    ...overrides,
  };
}
