import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockedFunction } from 'vitest';

import { createTicketFeature, listTicketsFeature } from '@/services/features/tickets/ticketsFeatures';
import { server as sources } from '@/services/sources/supabase/server';
import { classifyTicketWithLlm, draftCustomerReplyWithLlm } from '@/services/sources/llm/ticketTriage';
import type { TicketRow } from '@/services/sources/supabase/domains/tickets';

vi.mock('@/services/sources/supabase/server', () => ({
  server: {
    tickets: {
      list: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock('@/services/sources/llm/ticketTriage', () => ({
  classifyTicketWithLlm: vi.fn(),
  draftCustomerReplyWithLlm: vi.fn(),
}));

describe('ticketsFeatures', () => {
  const listMock = sources.tickets.list as unknown as MockedFunction<typeof sources.tickets.list>;
  const createMock = sources.tickets.create as unknown as MockedFunction<typeof sources.tickets.create>;
  const classifyMock = classifyTicketWithLlm as unknown as MockedFunction<typeof classifyTicketWithLlm>;
  const draftMock = draftCustomerReplyWithLlm as unknown as MockedFunction<typeof draftCustomerReplyWithLlm>;
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
    it('returns tickets on success', async () => {
      const mockTickets: TicketRow[] = [makeTicketRow({ id: '1', customer_name: 'Test User' })];
      listMock.mockResolvedValue(mockTickets);

      const result = await listTicketsFeature();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(mockTickets);
      }
    });

    it('returns failure when database fails', async () => {
      listMock.mockRejectedValue(new Error('DB Error'));

      const result = await listTicketsFeature();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('TICKETS_LIST_FAILED');
      }
    });
  });

  describe('createTicketFeature', () => {
    const validTicketInput = {
      customerName: 'Jane Doe',
      email: 'jane@example.com',
      subject: 'Login issue',
      description: 'I cannot log in to my account.',
    };

    it('creates a ticket when triage succeeds', async () => {
      classifyMock.mockResolvedValue({
        priority: 'High',
        category: 'Account',
      });
      draftMock.mockResolvedValue({ customerMessage: 'Please reset your password.' });

      const created = makeTicketRow({
        id: '123',
        customer_name: validTicketInput.customerName,
        email: validTicketInput.email,
        subject: validTicketInput.subject,
        description: validTicketInput.description,
        priority: 'High',
        category: 'Account',
        suggested_response: 'Please reset your password.',
        triage_status: 'succeeded',
        triage_error: null,
      });
      createMock.mockResolvedValue(created);

      const result = await createTicketFeature({ ticket: validTicketInput });

      expect(classifyTicketWithLlm).toHaveBeenCalledWith({
        subject: validTicketInput.subject,
        description: validTicketInput.description,
      });
      expect(draftCustomerReplyWithLlm).toHaveBeenCalledWith({
        priority: 'High',
        category: 'Account',
        subject: validTicketInput.subject,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(created);
      }
    });

    it('falls back when classification fails', async () => {
      classifyMock.mockRejectedValue(new Error('LLM Error'));
      draftMock.mockResolvedValue({ customerMessage: 'Fallback message' });

      const created = makeTicketRow({
        id: '123',
        customer_name: validTicketInput.customerName,
        email: validTicketInput.email,
        subject: validTicketInput.subject,
        description: validTicketInput.description,
        priority: 'Low',
        category: 'General',
        suggested_response: 'Fallback message',
        triage_status: 'failed',
        triage_error: 'LLM_CLASSIFICATION_FAILED',
      });
      createMock.mockResolvedValue(created);

      const result = await createTicketFeature({ ticket: validTicketInput });

      expect(draftCustomerReplyWithLlm).toHaveBeenCalledWith({
        priority: 'Low',
        category: 'General',
        subject: validTicketInput.subject,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.triage_status).toBe('failed');
      }
    });

    it('falls back when customer reply drafting fails', async () => {
      classifyMock.mockResolvedValue({ priority: 'Medium', category: 'Billing' });
      draftMock.mockRejectedValue(new Error('LLM Error'));

      const created = makeTicketRow({
        id: '123',
        customer_name: validTicketInput.customerName,
        email: validTicketInput.email,
        subject: validTicketInput.subject,
        description: validTicketInput.description,
        priority: 'Medium',
        category: 'Billing',
        suggested_response:
          "Thanks for reaching out. We've received your request and our team will review it. If you can share any additional details, we'll be able to help faster.",
        triage_status: 'failed',
        triage_error: 'LLM_RESPONSE_FAILED',
      });
      createMock.mockResolvedValue(created);

      const result = await createTicketFeature({ ticket: validTicketInput });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.triage_error).toBe('LLM_RESPONSE_FAILED');
      }
    });

    it('returns validation error when required fields are missing', async () => {
      const result = await createTicketFeature({
        ticket: { ...validTicketInput, customerName: '' },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('returns failure when persistence fails', async () => {
      classifyMock.mockResolvedValue({ priority: 'Medium', category: 'General' });
      draftMock.mockResolvedValue({ customerMessage: 'Hi' });
      createMock.mockRejectedValue(new Error('DB Error'));

      const result = await createTicketFeature({ ticket: validTicketInput });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('TICKET_CREATE_FAILED');
      }
    });
  });
});

function makeTicketRow(overrides: Partial<TicketRow> = {}): TicketRow {
  return {
    id: '00000000-0000-0000-0000-000000000000',
    created_at: new Date(0).toISOString(),
    customer_name: 'Customer',
    email: 'customer@example.com',
    subject: 'Subject',
    description: 'Description',
    priority: 'Low',
    category: 'General',
    suggested_response: 'Response',
    triage_status: 'succeeded',
    triage_error: null,
    ...overrides,
  } as TicketRow;
}
