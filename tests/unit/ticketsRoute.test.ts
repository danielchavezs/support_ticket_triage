import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockedFunction } from 'vitest';
import { GET, POST } from '@/app/api/tickets/route';
import { createTicketFeature, listTicketsFeature } from '@/services/features/tickets';
import type { TicketRow } from '@/services/providers/supabase/domains/tickets';

vi.mock('@/services/features/tickets', () => ({
  listTicketsFeature: vi.fn(),
  createTicketFeature: vi.fn(),
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

describe('Tickets API Route', () => {
  const listMock = listTicketsFeature as unknown as MockedFunction<typeof listTicketsFeature>;
  const createMock = createTicketFeature as unknown as MockedFunction<typeof createTicketFeature>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET', () => {
    it('returns 200 and list of tickets on success', async () => {
      const mockTickets: TicketRow[] = [makeTicketRow({ id: '1', subject: 'Test' })];
      listMock.mockResolvedValue({ success: true, data: mockTickets } as Awaited<ReturnType<typeof listTicketsFeature>>);

      const response = (await GET(makeRequest(`https://example.local/api/tickets?orgId=${ORG_A}`))) as MockResponse;
      const json = (await response.json()) as { tickets: Array<{ subject: string; status: string }> };

      expect(response.status).toBe(200);
      expect(listMock).toHaveBeenCalledWith({ orgId: ORG_A });
      expect(json.tickets).toHaveLength(1);
      expect(json.tickets[0].subject).toBe('Test');
    });

    it('returns 400 when orgId is missing from the query string', async () => {
      const response = (await GET(makeRequest('https://example.local/api/tickets'))) as MockResponse;
      const json = (await response.json()) as { error: { code: string } };

      expect(response.status).toBe(400);
      expect(json.error.code).toBe('VALIDATION_ERROR');
      expect(listMock).not.toHaveBeenCalled();
    });

    it('returns 400 when orgId is not a UUID', async () => {
      const response = (await GET(
        makeRequest('https://example.local/api/tickets?orgId=not-a-uuid'),
      )) as MockResponse;
      expect(response.status).toBe(400);
      expect(listMock).not.toHaveBeenCalled();
    });

    it('returns 500 on non-validation feature failure', async () => {
      listMock.mockResolvedValue({
        success: false,
        error: { code: 'TICKETS_LIST_FAILED', message: 'Error' },
      } as Awaited<ReturnType<typeof listTicketsFeature>>);

      const response = (await GET(makeRequest(`https://example.local/api/tickets?orgId=${ORG_A}`))) as MockResponse;
      expect(response.status).toBe(500);
    });
  });

  describe('POST', () => {
    const validBody = {
      orgId: ORG_A,
      userId: USER_A,
      subject: 'Login issue',
      description: 'I cannot log in.',
    };

    it('returns 201 and forwards the v1 body to the Feature', async () => {
      const mockRequest = { json: async () => validBody } as Request;

      createMock.mockResolvedValue({
        success: true,
        data: makeTicketRow({ id: '123', subject: validBody.subject, description: validBody.description }),
      } as Awaited<ReturnType<typeof createTicketFeature>>);

      const response = (await POST(mockRequest)) as MockResponse;
      const json = (await response.json()) as { ticket: { id: string; status: string } };

      expect(response.status).toBe(201);
      expect(createMock).toHaveBeenCalledWith(validBody);
      expect(json.ticket.id).toBe('123');
      expect(json.ticket.status).toBe('received');
    });

    it('returns 400 for invalid JSON', async () => {
      const mockRequest = { json: () => Promise.reject(new Error('SyntaxError')) } as Request;

      const response = (await POST(mockRequest)) as MockResponse;
      expect(response.status).toBe(400);
      expect(createMock).not.toHaveBeenCalled();
    });

    it('returns 400 when body is not a JSON object', async () => {
      const mockRequest = { json: async () => [validBody] } as Request;

      const response = (await POST(mockRequest)) as MockResponse;
      const json = (await response.json()) as { error: { code: string } };

      expect(response.status).toBe(400);
      expect(json.error.code).toBe('VALIDATION_ERROR');
    });

    it.each([
      ['orgId missing', { orgId: undefined }],
      ['orgId not a UUID', { orgId: 'not-a-uuid' }],
      ['userId missing', { userId: undefined }],
      ['userId not a UUID', { userId: 'not-a-uuid' }],
      ['subject missing', { subject: '' }],
      ['description missing', { description: '   ' }],
    ])('returns 400 when %s', async (_label, overrides) => {
      const mockRequest = { json: async () => ({ ...validBody, ...overrides }) } as Request;

      const response = (await POST(mockRequest)) as MockResponse;
      expect(response.status).toBe(400);
      expect(createMock).not.toHaveBeenCalled();
    });

    it('returns 400 when feature returns VALIDATION_ERROR', async () => {
      const mockRequest = { json: async () => validBody } as Request;

      createMock.mockResolvedValue({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Bad input.' },
      } as Awaited<ReturnType<typeof createTicketFeature>>);

      const response = (await POST(mockRequest)) as MockResponse;
      expect(response.status).toBe(400);
    });

    it('returns 500 when feature returns a non-validation error', async () => {
      const mockRequest = { json: async () => validBody } as Request;

      createMock.mockResolvedValue({
        success: false,
        error: { code: 'TICKET_CREATE_FAILED', message: 'DB down.' },
      } as Awaited<ReturnType<typeof createTicketFeature>>);

      const response = (await POST(mockRequest)) as MockResponse;
      expect(response.status).toBe(500);
    });
  });
});

type MockResponse = { json: () => Promise<unknown>; status: number };

function makeRequest(url: string): Request {
  return new Request(url);
}

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
