import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockedFunction } from 'vitest';
import { retryTicketTriageFeature } from '@/services/features/tickets/ticketsFeatures';
import { server as sources } from '@/services/sources/supabase/server';
import { classifyTicketWithLlm, draftCustomerReplyWithLlm } from '@/services/sources/llm/ticketTriage';
import type { TicketRow } from '@/services/sources/supabase/domains/tickets';

vi.mock('@/services/sources/supabase/server', () => ({
    server: {
        tickets: {
            getById: vi.fn(),
            updateTriage: vi.fn(),
        },
    },
}));

vi.mock('@/services/sources/llm/ticketTriage', () => ({
    classifyTicketWithLlm: vi.fn(),
    draftCustomerReplyWithLlm: vi.fn(),
}));

describe('retryTicketTriageFeature', () => {
    const getByIdMock = sources.tickets.getById as unknown as MockedFunction<typeof sources.tickets.getById>;
    const updateTriageMock = sources.tickets.updateTriage as unknown as MockedFunction<
        typeof sources.tickets.updateTriage
    >;
    const classifyMock = classifyTicketWithLlm as unknown as MockedFunction<typeof classifyTicketWithLlm>;
    const draftMock = draftCustomerReplyWithLlm as unknown as MockedFunction<typeof draftCustomerReplyWithLlm>;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

    beforeEach(() => {
        vi.clearAllMocks();
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
    });

    afterEach(() => {
        consoleErrorSpy?.mockRestore();
        consoleErrorSpy = null;
    });

    const existingTicket: TicketRow = {
        id: '123',
        created_at: '2024-01-01',
        customer_name: 'Jane Doe',
        email: 'jane@example.com',
        subject: 'Login issue',
        description: 'Cannot log in',
        priority: 'Low',
        category: 'General',
        suggested_response: 'Fallback response',
        triage_status: 'failed',
        triage_error: 'LLM_CLASSIFICATION_FAILED',
    };

    it('returns error when ticket is not found', async () => {
        getByIdMock.mockResolvedValue(null);

        const result = await retryTicketTriageFeature({ ticketId: '999' });

        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.code).toBe('TICKET_NOT_FOUND');
        }
    });

    it('returns error when ticket fetch fails', async () => {
        getByIdMock.mockRejectedValue(new Error('DB Error'));

        const result = await retryTicketTriageFeature({ ticketId: '123' });

        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.code).toBe('TICKET_FETCH_FAILED');
        }
    });

    it('successfully retries triage when LLM works', async () => {
        getByIdMock.mockResolvedValue(existingTicket);
        classifyMock.mockResolvedValue({ priority: 'High', category: 'Account' });
        draftMock.mockResolvedValue({ customerMessage: 'Please reset your password.' });

        const updatedTicket: TicketRow = {
            ...existingTicket,
            priority: 'High',
            category: 'Account',
            suggested_response: 'Please reset your password.',
            triage_status: 'succeeded',
            triage_error: null,
        };
        updateTriageMock.mockResolvedValue(updatedTicket);

        const result = await retryTicketTriageFeature({ ticketId: '123' });

        expect(classifyTicketWithLlm).toHaveBeenCalledWith({
            subject: existingTicket.subject,
            description: existingTicket.description,
        });
        expect(draftCustomerReplyWithLlm).toHaveBeenCalledWith({
            priority: 'High',
            category: 'Account',
            subject: existingTicket.subject,
        });
        expect(updateTriageMock).toHaveBeenCalledWith('123', {
            priority: 'High',
            category: 'Account',
            suggested_response: 'Please reset your password.',
            triage_status: 'succeeded',
            triage_error: null,
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.triage_status).toBe('succeeded');
        }
    });

    it('keeps existing values when classification fails on retry', async () => {
        getByIdMock.mockResolvedValue(existingTicket);
        classifyMock.mockRejectedValue(new Error('LLM Error'));
        draftMock.mockResolvedValue({ customerMessage: 'New response' });

        const updatedTicket: TicketRow = {
            ...existingTicket,
            suggested_response: 'New response',
            triage_status: 'failed',
            triage_error: 'LLM_CLASSIFICATION_FAILED',
        };
        updateTriageMock.mockResolvedValue(updatedTicket);

        const result = await retryTicketTriageFeature({ ticketId: '123' });

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.triage_status).toBe('failed');
            expect(result.data.triage_error).toBe('LLM_CLASSIFICATION_FAILED');
        }
    });

    it('keeps existing response when drafting fails on retry', async () => {
        getByIdMock.mockResolvedValue(existingTicket);
        classifyMock.mockResolvedValue({ priority: 'Medium', category: 'Technical' });
        draftMock.mockRejectedValue(new Error('LLM Error'));

        const updatedTicket: TicketRow = {
            ...existingTicket,
            priority: 'Medium',
            category: 'Technical',
            suggested_response: existingTicket.suggested_response,
            triage_status: 'failed',
            triage_error: 'LLM_RESPONSE_FAILED',
        };
        updateTriageMock.mockResolvedValue(updatedTicket);

        const result = await retryTicketTriageFeature({ ticketId: '123' });

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.triage_error).toBe('LLM_RESPONSE_FAILED');
        }
    });

    it('returns error when update fails', async () => {
        getByIdMock.mockResolvedValue(existingTicket);
        classifyMock.mockResolvedValue({ priority: 'High', category: 'Account' });
        draftMock.mockResolvedValue({ customerMessage: 'Response' });
        updateTriageMock.mockRejectedValue(new Error('DB Error'));

        const result = await retryTicketTriageFeature({ ticketId: '123' });

        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.code).toBe('TICKET_UPDATE_FAILED');
        }
    });
});
