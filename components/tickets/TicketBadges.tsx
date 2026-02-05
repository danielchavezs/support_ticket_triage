import type { Ticket } from '@/components/tickets/types';

export default function TicketBadges(props: { priority: Ticket['priority']; category: Ticket['category']; triageStatus: Ticket['triageStatus'] }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge(props.priority)}`}>{props.priority}</span>
      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700">{props.category}</span>
      {props.triageStatus === 'failed' ? (
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
          Triage failed (fallback)
        </span>
      ) : null}
    </div>
  );
}

function badge(priority: Ticket['priority']) {
  switch (priority) {
    case 'Critical':
      return 'bg-red-100 text-red-800';
    case 'High':
      return 'bg-orange-100 text-orange-800';
    case 'Medium':
      return 'bg-yellow-100 text-yellow-900';
    case 'Low':
      return 'bg-green-100 text-green-800';
  }
}

