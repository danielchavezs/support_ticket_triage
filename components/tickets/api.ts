import type { ApiError, NewTicketPayload, Ticket } from '@/components/tickets/types';

export async function fetchTickets(): Promise<Ticket[]> {
  const res = await fetch('/api/tickets', { cache: 'no-store' });
  const json = (await res.json()) as { tickets?: Ticket[]; error?: ApiError };
  if (!res.ok) throw new Error(json.error?.message ?? 'Failed to fetch tickets.');
  return json.tickets ?? [];
}

export async function createTicket(payload: NewTicketPayload): Promise<Ticket> {
  const res = await fetch('/api/tickets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = (await res.json()) as { ticket?: Ticket; error?: ApiError };
  if (!res.ok) throw new Error(json.error?.message ?? 'Failed to submit ticket.');
  if (!json.ticket) throw new Error('Server returned no ticket.');
  return json.ticket;
}

