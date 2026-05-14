'use client';

import type { Ticket } from '@/components/tickets/types';

export default function SuccessBanner(props: { ticket: Ticket | null }) {
  if (!props.ticket) return null;

  const isFailed = props.ticket.status === 'failed';

  const variant = isFailed
    ? 'border-amber-200 bg-amber-50 text-amber-900'
    : 'border-green-200 bg-green-50 text-green-800';

  return (
    <div className={`rounded-md border px-3 py-2 text-sm ${variant}`} role="status" aria-live="polite">
      <div>
        Ticket submitted. Status: <span className="font-medium">{props.ticket.status.replace(/_/g, ' ')}</span>
        {props.ticket.priority ? (
          <>
            {' '}
            / <span className="font-medium">{props.ticket.priority}</span>
          </>
        ) : null}
        {props.ticket.type ? (
          <>
            {' '}
            / <span className="font-medium">{props.ticket.type}</span>
          </>
        ) : null}
        {isFailed ? ' (Triage failed.)' : null}
      </div>

      {props.ticket.suggestedReply ? (
        <div className="mt-2 rounded-md border border-black/10 bg-white/70 px-3 py-2">
          <div className="text-xs font-medium uppercase tracking-wide opacity-80">Suggested reply</div>
          <p className="mt-1 whitespace-pre-wrap">{props.ticket.suggestedReply}</p>
        </div>
      ) : (
        <div className="mt-2 text-xs italic opacity-80">
          Suggested reply pending.
        </div>
      )}
    </div>
  );
}
