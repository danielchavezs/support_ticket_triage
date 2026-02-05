import { NextResponse } from 'next/server';
import { retryTicketTriageFeature } from '@/services/features/tickets';

export const runtime = 'nodejs';

export async function POST(
    _request: Request,
    context: { params: Promise<{ id: string }> },
): Promise<Response> {
    const { id } = await context.params;

    if (!id) {
        return NextResponse.json(
            { error: { code: 'VALIDATION_ERROR', message: 'Ticket ID is required' } },
            { status: 400 },
        );
    }

    const result = await retryTicketTriageFeature({ ticketId: id });

    if (!result.success) {
        const statusCode = result.error.code === 'TICKET_NOT_FOUND' ? 404 : 500;
        return NextResponse.json({ error: result.error }, { status: statusCode });
    }

    // Map snake_case to camelCase for the UI
    const ticket = result.data;
    return NextResponse.json(
        {
            ticket: {
                id: ticket.id,
                createdAt: ticket.created_at,
                customerName: ticket.customer_name,
                email: ticket.email,
                subject: ticket.subject,
                description: ticket.description,
                priority: ticket.priority,
                category: ticket.category,
                suggestedResponse: ticket.suggested_response,
                triageStatus: ticket.triage_status,
                triageError: ticket.triage_error,
            },
        },
        { status: 200 },
    );
}
