'use client';

import type { Ticket } from '@/components/tickets/types';

export default function SuccessBanner(props: {
  ticket: Ticket | null;
}) {
  if (!props.ticket) return null;

  const variant =
    props.ticket.triageStatus === 'failed'
      ? 'border-amber-200 bg-amber-50 text-amber-900'
      : 'border-green-200 bg-green-50 text-green-800';

  const displayPriority = props.ticket.priority === 'Critical' ? 'High' : props.ticket.priority;

  return (
    <div className={`rounded-md border px-3 py-2 text-sm ${variant}`} role="status" aria-live="polite">
      <div>
        Ticket submitted. Classified as <span className="font-medium">{displayPriority}</span> /{' '}
        <span className="font-medium">{props.ticket.category}</span>.
        {props.ticket.priority === 'Critical' ? ' (Escalated for immediate review.)' : null}
        {props.ticket.triageStatus === 'failed' ? ' (Fallback used due to triage error.)' : null}
      </div>

      <div className="mt-2 rounded-md border border-black/10 bg-white/70 px-3 py-2">
        <div className="text-xs font-medium uppercase tracking-wide opacity-80">Suggested response</div>
        <p className="mt-1 whitespace-pre-wrap">{props.ticket.suggestedResponse}</p>
      </div>
    </div>
  );
}
