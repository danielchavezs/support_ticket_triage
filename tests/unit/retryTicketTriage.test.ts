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

  function callRoute(id: string) {
    return POST({} as Request, { params: Promise.resolve({ id }) }) as Promise<{
      json: () => Promise<unknown>;
      status: number;
    }>;
  }

  it('returns 200 with the ticket unchanged (Phase 1 stub)', async () => {
    const ticket = makeTicketRow({ id: '00000000-0000-0000-0000-0000000000c1', status: 'received' });
    retryMock.mockResolvedValue({ success: true, data: ticket });

    const response = await callRoute('00000000-0000-0000-0000-0000000000c1');
    const json = (await response.json()) as { ticket: { id: string; status: string } };

    expect(retryMock).toHaveBeenCalledWith({ orgId: ORG_A, ticketId: '00000000-0000-0000-0000-0000000000c1' });
    expect(response.status).toBe(200);
    expect(json.ticket.id).toBe('00000000-0000-0000-0000-0000000000c1');
    expect(json.ticket.status).toBe('received');
  });

  it('returns 400 when no ticket id is supplied', async () => {
    const response = await callRoute('');
    expect(response.status).toBe(400);
    expect(retryMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the Feature reports TICKET_NOT_FOUND', async () => {
    retryMock.mockResolvedValue({
      success: false,
      error: { code: 'TICKET_NOT_FOUND', message: 'Not found.' },
    });

    const response = await callRoute('00000000-0000-0000-0000-0000000000c1');
    expect(response.status).toBe(404);
  });

  it('returns 500 on other Feature errors', async () => {
    retryMock.mockResolvedValue({
      success: false,
      error: { code: 'TICKET_FETCH_FAILED', message: 'DB down.' },
    });

    const response = await callRoute('00000000-0000-0000-0000-0000000000c1');
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
    description_embedding: null,
    ...overrides,
  };
}
