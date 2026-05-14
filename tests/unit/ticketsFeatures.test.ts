import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockedFunction } from 'vitest';

import {
  createTicketFeature,
  getTicketFeature,
  listTicketsFeature,
  retryTicketTriageFeature,
} from '@/services/features/tickets/ticketsFeatures';
import { server as sources } from '@/services/providers/supabase/server';
import type { TicketRow } from '@/services/providers/supabase/domains/tickets';

vi.mock('@/services/providers/supabase/server', () => ({
  server: {
    tickets: {
      list: vi.fn(),
      getById: vi.fn(),
      create: vi.fn(),
      updateTriage: vi.fn(),
    },
    ticketEvents: {
      create: vi.fn(),
      listByTicket: vi.fn(),
    },
    orgs: { getById: vi.fn() },
    users: { getById: vi.fn(), findByEmail: vi.fn() },
  },
}));

const ORG_A = '00000000-0000-0000-0000-00000000000a';
const ORG_B = '00000000-0000-0000-0000-00000000000b';
const USER_A = '00000000-0000-0000-0000-0000000000a1';

describe('tickets feature', () => {
  const listMock = sources.tickets.list as unknown as MockedFunction<typeof sources.tickets.list>;
  const getByIdMock = sources.tickets.getById as unknown as MockedFunction<typeof sources.tickets.getById>;
  const createMock = sources.tickets.create as unknown as MockedFunction<typeof sources.tickets.create>;
  const eventCreateMock = sources.ticketEvents.create as unknown as MockedFunction<typeof sources.ticketEvents.create>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy?.mockRestore();
    consoleErrorSpy = null;
  });

  describe('listTicketsFeature', () => {
    it('returns tickets on success and forwards orgId to the Provider', async () => {
      const mockTickets: TicketRow[] = [makeTicketRow({ id: 'aaa', org_id: ORG_A })];
      listMock.mockResolvedValue(mockTickets);

      const result = await listTicketsFeature({ orgId: ORG_A });

      expect(listMock).toHaveBeenCalledWith({ orgId: ORG_A });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual(mockTickets);
    });

    it('isolates by org — listing for one org never reaches another org context', async () => {
      // Provider is the org-enforcement boundary. The Feature must pass through
      // exactly the orgId it received, never silently falling back to a default.
      listMock.mockResolvedValue([]);

      await listTicketsFeature({ orgId: ORG_B });

      expect(listMock).toHaveBeenCalledExactlyOnceWith({ orgId: ORG_B });
      expect(listMock).not.toHaveBeenCalledWith({ orgId: ORG_A });
    });

    it('rejects an invalid orgId at the Feature boundary', async () => {
      const result = await listTicketsFeature({ orgId: 'not-a-uuid' });

      expect(listMock).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns TICKETS_LIST_FAILED when the Provider throws', async () => {
      listMock.mockRejectedValue(new Error('DB Error'));

      const result = await listTicketsFeature({ orgId: ORG_A });

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe('TICKETS_LIST_FAILED');
    });
  });

  describe('createTicketFeature', () => {
    const baseInput = {
      orgId: ORG_A,
      userId: USER_A,
      subject: 'Login issue',
      description: 'I cannot log in to my account.',
    };

    it('creates a ticket and emits ticket_events.received', async () => {
      const created = makeTicketRow({ id: '123', org_id: ORG_A, user_id: USER_A, subject: baseInput.subject });
      createMock.mockResolvedValue(created);
      eventCreateMock.mockResolvedValue({
        id: 'evt-1',
        org_id: ORG_A,
        ticket_id: '123',
        event_type: 'received',
        payload: {},
        created_at: new Date(0).toISOString(),
      });

      const result = await createTicketFeature(baseInput);

      expect(createMock).toHaveBeenCalledWith({
        orgId: ORG_A,
        userId: USER_A,
        subject: 'Login issue',
        description: 'I cannot log in to my account.',
        sourceKind: undefined,
      });
      expect(eventCreateMock).toHaveBeenCalledWith({
        orgId: ORG_A,
        ticketId: '123',
        eventType: 'received',
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual(created);
    });

    it.each([
      ['orgId', { orgId: 'not-a-uuid' }],
      ['userId', { userId: 'not-a-uuid' }],
      ['subject', { subject: '   ' }],
      ['description', { description: '   ' }],
    ])('returns VALIDATION_ERROR when %s is invalid', async (_field, overrides) => {
      const result = await createTicketFeature({ ...baseInput, ...overrides });

      expect(createMock).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns TICKET_CREATE_FAILED when the Provider create throws', async () => {
      createMock.mockRejectedValue(new Error('DB Error'));

      const result = await createTicketFeature(baseInput);

      expect(eventCreateMock).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe('TICKET_CREATE_FAILED');
    });

    it('treats event emission failure as non-fatal', async () => {
      // The ticket existing is the more important invariant. A failed event
      // emission logs but the ticket is still returned to the caller.
      const created = makeTicketRow({ id: '123', org_id: ORG_A });
      createMock.mockResolvedValue(created);
      eventCreateMock.mockRejectedValue(new Error('events table down'));

      const result = await createTicketFeature(baseInput);

      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual(created);
    });

    it('forwards an explicit sourceKind when provided', async () => {
      const created = makeTicketRow({ id: '456', org_id: ORG_A });
      createMock.mockResolvedValue(created);
      eventCreateMock.mockResolvedValue({
        id: 'evt-2',
        org_id: ORG_A,
        ticket_id: '456',
        event_type: 'received',
        payload: {},
        created_at: new Date(0).toISOString(),
      });

      await createTicketFeature({ ...baseInput, sourceKind: 'aip_monitoring' });

      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({ sourceKind: 'aip_monitoring' }),
      );
    });
  });

  describe('getTicketFeature', () => {
    it('returns the ticket when found', async () => {
      const ticket = makeTicketRow({ id: '00000000-0000-0000-0000-0000000000c1', org_id: ORG_A });
      getByIdMock.mockResolvedValue(ticket);

      const result = await getTicketFeature({ orgId: ORG_A, ticketId: '00000000-0000-0000-0000-0000000000c1' });

      expect(getByIdMock).toHaveBeenCalledWith({ orgId: ORG_A, ticketId: '00000000-0000-0000-0000-0000000000c1' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual(ticket);
    });

    it('returns TICKET_NOT_FOUND when the Provider returns null (including cross-org)', async () => {
      // The Provider returns null for both "really not in DB" and "exists in
      // a different org" cases. Feature treats them identically.
      getByIdMock.mockResolvedValue(null);

      const result = await getTicketFeature({ orgId: ORG_A, ticketId: '00000000-0000-0000-0000-0000000000c1' });

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe('TICKET_NOT_FOUND');
    });

    it('returns TICKET_FETCH_FAILED on Provider throw', async () => {
      getByIdMock.mockRejectedValue(new Error('DB Error'));

      const result = await getTicketFeature({ orgId: ORG_A, ticketId: '00000000-0000-0000-0000-0000000000c1' });

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe('TICKET_FETCH_FAILED');
    });
  });

  describe('retryTicketTriageFeature', () => {
    it('returns the ticket unchanged (Phase 1 no-op stub)', async () => {
      const ticket = makeTicketRow({ id: '00000000-0000-0000-0000-0000000000c1', org_id: ORG_A, status: 'failed' });
      getByIdMock.mockResolvedValue(ticket);

      const result = await retryTicketTriageFeature({ orgId: ORG_A, ticketId: '00000000-0000-0000-0000-0000000000c1' });

      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual(ticket);
    });

    it('returns TICKET_NOT_FOUND when the ticket does not exist', async () => {
      getByIdMock.mockResolvedValue(null);

      const result = await retryTicketTriageFeature({ orgId: ORG_A, ticketId: '00000000-0000-0000-0000-0000000000c1' });

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe('TICKET_NOT_FOUND');
    });
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
