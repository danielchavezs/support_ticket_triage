import TicketBadges from '@/components/tickets/TicketBadges';
import type { Ticket } from '@/components/tickets/types';

export default function TicketDetails(props: { ticket: Ticket }) {
  const ticket = props.ticket;

  return (
    <details className="group rounded-lg border border-zinc-200 bg-white p-3">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
        <div className="min-w-0">
          <TicketBadges priority={ticket.priority} category={ticket.category} triageStatus={ticket.triageStatus} />
          <div className="mt-2 truncate text-sm font-medium text-zinc-900">
            {ticket.customerName} — {ticket.subject}
          </div>
          <div className="mt-1 text-xs text-zinc-500">{new Date(ticket.createdAt).toLocaleString()}</div>
        </div>
        <span className="mt-1 text-zinc-400 transition group-open:rotate-180">▾</span>
      </summary>

      <div className="mt-3 grid gap-3 text-sm">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Description</div>
          <p className="mt-1 whitespace-pre-wrap text-zinc-800">{ticket.description}</p>
        </div>
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Suggested response</div>
          <p className="mt-1 whitespace-pre-wrap text-zinc-800">{ticket.suggestedResponse}</p>
        </div>
        <div className="text-xs text-zinc-500">
          Contact: {ticket.email}
          {ticket.triageError ? ` • Triage error: ${ticket.triageError}` : null}
        </div>
      </div>
    </details>
  );
}

