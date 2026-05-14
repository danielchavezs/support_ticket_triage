import type { Ticket, TicketPriority, TicketStatus } from '@/components/tickets/types';

export default function TicketBadges(props: {
  priority: Ticket['priority'];
  status: Ticket['status'];
  type: Ticket['type'];
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {props.priority ? (
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${priorityClass(props.priority)}`}>
          {props.priority}
        </span>
      ) : (
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500">
          Triage pending
        </span>
      )}
      {props.type ? (
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700">{props.type}</span>
      ) : null}
      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(props.status)}`}>
        {props.status.replace(/_/g, ' ')}
      </span>
    </div>
  );
}

function priorityClass(priority: TicketPriority) {
  switch (priority) {
    case 'P1':
      return 'bg-red-100 text-red-800';
    case 'P2':
      return 'bg-orange-100 text-orange-800';
    case 'P3':
      return 'bg-yellow-100 text-yellow-900';
    case 'P4':
      return 'bg-green-100 text-green-800';
  }
}

function statusClass(status: TicketStatus) {
  switch (status) {
    case 'received':
      return 'bg-sky-100 text-sky-800';
    case 'triaged':
      return 'bg-indigo-100 text-indigo-800';
    case 'pushed_to_linear':
      return 'bg-violet-100 text-violet-800';
    case 'duplicate':
      return 'bg-zinc-200 text-zinc-700';
    case 'failed':
      return 'bg-amber-100 text-amber-900';
    case 'closed':
      return 'bg-emerald-100 text-emerald-800';
  }
}
