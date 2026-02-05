'use client';

import { useEffect, useMemo, useState } from 'react';

import { fetchTickets } from '@/components/tickets/api';
import SkeletonList from '@/components/tickets/SkeletonList';
import TicketList from '@/components/tickets/TicketList';
import type { Ticket } from '@/components/tickets/types';

export default function TicketDashboardClient() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const loadTickets = async (isInitial = false) => {
      try {
        if (isInitial) setError(null);
        const data = await fetchTickets();
        if (mounted) setTickets(data);
      } catch (err) {
        if (mounted && isInitial) {
          setError(err instanceof Error ? err.message : 'Failed to fetch tickets.');
        }
      } finally {
        if (mounted && isInitial) setLoading(false);
      }
    };

    void loadTickets(true);

    // Poll every 30 seconds
    const intervalId = window.setInterval(() => {
      void loadTickets();
    }, 15000);

    return () => {
      mounted = false;
      window.clearInterval(intervalId);
    };
  }, []);

  const summary = useMemo(() => {
    const total = tickets.length;
    const failed = tickets.filter((t) => t.triageStatus === 'failed').length;
    return { total, failed };
  }, [tickets]);

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Tickets</h2>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-sm text-zinc-600">
              {loading ? 'Loading…' : `${summary.total} total`}
              {!loading && summary.failed ? ` • ${summary.failed} triage failed` : null}
            </span>
            {!loading && (
              <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
                </span>
                Live
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3">
        {loading ? <SkeletonList /> : null}
        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        ) : null}
        {!loading && !error && tickets.length === 0 ? (
          <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-6 text-center text-sm text-zinc-600">
            No tickets yet.
          </div>
        ) : null}
        {!loading && !error && tickets.length ? <TicketList tickets={tickets} /> : null}
      </div>
    </section>
  );
}

