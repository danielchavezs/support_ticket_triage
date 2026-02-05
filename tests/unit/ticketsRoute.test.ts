import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockedFunction } from 'vitest';
import { GET, POST } from '@/app/api/tickets/route';
import { listTicketsFeature, createTicketFeature } from '@/services/features/tickets';
import type { TicketRow } from '@/services/sources/supabase/domains/tickets';

// Mock feature layer
vi.mock('@/services/features/tickets', () => ({
    listTicketsFeature: vi.fn(),
    createTicketFeature: vi.fn(),
}));

// Simple mock for NextResponse
vi.mock('next/server', () => ({
    NextResponse: {
        json: vi.fn((data, init) => ({
            json: async () => data,
            status: init?.status ?? 200,
        })),
    },
}));

describe('Tickets API Route', () => {
    const listMock = listTicketsFeature as unknown as MockedFunction<typeof listTicketsFeature>;
    const createMock = createTicketFeature as unknown as MockedFunction<typeof createTicketFeature>;

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('GET', () => {
        it('returns 200 and list of tickets on success', async () => {
            const mockTickets: TicketRow[] = [
                makeTicketRow({
                    id: '1',
                    created_at: '2024-01-01',
                    customer_name: 'Jane',
                    email: 'jane@example.com',
                    subject: 'Test',
                    description: 'Desc',
                    priority: 'Low',
                    category: 'General',
                    suggested_response: 'Hi',
                    triage_status: 'succeeded',
                    triage_error: null,
                }),
            ];
            listMock.mockResolvedValue({ success: true, data: mockTickets } as Awaited<ReturnType<typeof listTicketsFeature>>);

            const response = (await GET()) as MockResponse;
            const json = (await response.json()) as { tickets: Array<{ customerName: string }> };

            expect(response.status).toBe(200);
            expect(json.tickets).toHaveLength(1);
            expect(json.tickets[0].customerName).toBe('Jane');
        });

        it('returns 500 on feature failure', async () => {
            listMock.mockResolvedValue({
                success: false,
                error: { code: 'FAIL', message: 'Error' },
            } as Awaited<ReturnType<typeof listTicketsFeature>>);

            const response = (await GET()) as MockResponse;
            expect(response.status).toBe(500);
        });
    });

    describe('POST', () => {
        const validPayload = {
            customerName: 'Jane',
            email: 'jane@example.com',
            subject: 'Issue',
            description: 'Help',
        };

        it('returns 201 and created ticket on success', async () => {
            const mockRequest = {
                json: async () => validPayload,
            } as Request;

            createMock.mockResolvedValue({
                success: true,
                data: makeTicketRow({
                    id: '123',
                    created_at: '2024-01-01',
                    customer_name: 'Jane',
                    email: 'jane@example.com',
                    subject: 'Issue',
                    description: 'Help',
                    priority: 'Medium',
                    category: 'General',
                    suggested_response: 'Ok',
                    triage_status: 'succeeded',
                    triage_error: null,
                }),
            } as Awaited<ReturnType<typeof createTicketFeature>>);

            const response = (await POST(mockRequest)) as MockResponse;
            const json = (await response.json()) as { ticket: { id: string } };

            expect(response.status).toBe(201);
            expect(json.ticket.id).toBe('123');
        });

        it('returns 400 for invalid JSON', async () => {
            const mockRequest = {
                json: () => Promise.reject(new Error('SyntaxError')),
            } as Request;

            const response = (await POST(mockRequest)) as MockResponse;
            expect(response.status).toBe(400);
        });

        it('returns 400 for missing fields', async () => {
            const mockRequest = {
                json: async () => ({ ...validPayload, customerName: '' }),
            } as Request;

            const response = (await POST(mockRequest)) as MockResponse;
            expect(response.status).toBe(400);
        });
    });
});

type MockResponse = { json: () => Promise<unknown>; status: number };

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
