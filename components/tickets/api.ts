import type { ApiError, NewTicketPayload, Ticket } from '@/components/tickets/types';

/**
 * Dev-default caller identifiers. v1 has no real caller-authentication
 * mechanism (deferred to Phase 7 / BL-012), so the dashboard reads these
 * UUIDs from `NEXT_PUBLIC_DEV_ORG_ID` / `NEXT_PUBLIC_DEV_USER_ID` and sends
 * them on every request. The values match the seeded `ATD-internal` org
 * and dev user from `migrations/dev/2026-05-13_seed_dev_default.sql`.
 *
 * Phase 7 replaces this with HMAC-signed caller identification.
 */
function requireDevDefaults(): { orgId: string; userId: string } {
  const orgId = process.env.NEXT_PUBLIC_DEV_ORG_ID;
  const userId = process.env.NEXT_PUBLIC_DEV_USER_ID;
  if (!orgId) throw new Error('Missing env var: NEXT_PUBLIC_DEV_ORG_ID');
  if (!userId) throw new Error('Missing env var: NEXT_PUBLIC_DEV_USER_ID');
  return { orgId, userId };
}

export async function fetchTickets(): Promise<Ticket[]> {
  const { orgId } = requireDevDefaults();
  const res = await fetch(`/api/tickets?orgId=${encodeURIComponent(orgId)}`, { cache: 'no-store' });
  const json = (await res.json()) as { tickets?: Ticket[]; error?: ApiError };
  if (!res.ok) throw new Error(json.error?.message ?? 'Failed to fetch tickets.');
  return json.tickets ?? [];
}

export async function createTicket(payload: NewTicketPayload): Promise<Ticket> {
  const { orgId, userId } = requireDevDefaults();
  const res = await fetch('/api/tickets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orgId, userId, ...payload }),
  });
  const json = (await res.json()) as { ticket?: Ticket; error?: ApiError };
  if (!res.ok) throw new Error(json.error?.message ?? 'Failed to submit ticket.');
  if (!json.ticket) throw new Error('Server returned no ticket.');
  return json.ticket;
}

export async function retryTicketTriage(ticketId: string): Promise<Ticket> {
  const { orgId } = requireDevDefaults();
  const res = await fetch(`/api/tickets/${ticketId}/retry-triage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orgId }),
  });
  const json = (await res.json()) as { ticket?: Ticket; error?: ApiError };
  if (!res.ok) throw new Error(json.error?.message ?? 'Failed to retry triage.');
  if (!json.ticket) throw new Error('Server returned no ticket.');
  return json.ticket;
}
