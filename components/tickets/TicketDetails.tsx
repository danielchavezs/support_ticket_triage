'use client';

import { useState } from 'react';
import TicketBadges from '@/components/tickets/TicketBadges';
import Loader from '@/components/tickets/Loader';
import { retryTicketTriage } from '@/components/tickets/api';
import type { Ticket } from '@/components/tickets/types';

export default function TicketDetails(props: {
  ticket: Ticket;
  onTicketUpdated?: (updatedTicket: Ticket) => void;
}) {
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  async function handleRetry() {
    setRetrying(true);
    setRetryError(null);
    try {
      const updated = await retryTicketTriage(props.ticket.id);
      props.onTicketUpdated?.(updated);
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : 'Failed to retry triage.');
    } finally {
      setRetrying(false);
    }
  }

  return (
    <details className="group rounded-lg border border-zinc-200 bg-white p-3">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
        <div className="min-w-0">
          <TicketBadges
            priority={props.ticket.priority}
            category={props.ticket.category}
            triageStatus={props.ticket.triageStatus}
          />
          <div className="mt-2 truncate text-sm font-medium text-zinc-900">
            {props.ticket.customerName} — {props.ticket.subject}
          </div>
          <div className="mt-1 text-xs text-zinc-500">{new Date(props.ticket.createdAt).toLocaleString()}</div>
        </div>
        <span className="mt-1 text-zinc-400 transition group-open:rotate-180">▾</span>
      </summary>

      <div className="mt-3 grid gap-3 text-sm">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Description</div>
          <p className="mt-1 whitespace-pre-wrap text-zinc-800">{props.ticket.description}</p>
        </div>
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Suggested response</div>
          <p className="mt-1 whitespace-pre-wrap text-zinc-800">{props.ticket.suggestedResponse}</p>
        </div>
        <div className="text-xs text-zinc-500">
          Contact: {props.ticket.email}
          {props.ticket.triageError ? ` • Triage error: ${props.ticket.triageError}` : null}
        </div>

        {props.ticket.triageStatus === 'failed' && (
          <div className="flex flex-col gap-2 border-t border-zinc-100 pt-3">
            <button
              onClick={handleRetry}
              disabled={retrying}
              className="group relative inline-flex h-9 items-center justify-center overflow-hidden rounded-md bg-amber-600 px-4 text-xs font-medium text-white transition-all duration-200 hover:bg-amber-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {retrying ? (
                <div className="flex items-center gap-2 animate-in fade-in zoom-in-95 duration-200">
                  <Loader size="sm" />
                  <span>Retrying AI triage...</span>
                </div>
              ) : (
                <span className="animate-in fade-in slide-in-from-bottom-1 duration-300">Retry AI triage</span>
              )}
            </button>
            {retryError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-700 animate-in fade-in slide-in-from-top-1">
                {retryError}
              </div>
            )}
          </div>
        )}
      </div>
    </details>
  );
}

