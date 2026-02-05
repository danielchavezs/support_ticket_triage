import TicketDetails from '@/components/tickets/TicketDetails';
import type { Ticket } from '@/components/tickets/types';

export default function TicketList(props: { tickets: Ticket[] }) {
  return (
    <div className="flex flex-col gap-3">
      {props.tickets.map((ticket) => (
        <TicketDetails key={ticket.id} ticket={ticket} />
      ))}
    </div>
  );
}

