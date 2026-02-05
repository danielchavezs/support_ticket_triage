'use client';

import { useRef, useState } from 'react';

import { createTicket } from '@/components/tickets/api';
import SuccessBanner from '@/components/tickets/SuccessBanner';
import Loader from '@/components/tickets/Loader';
import type { NewTicketPayload, Ticket } from '@/components/tickets/types';

export default function TicketSubmitClient() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successTicket, setSuccessTicket] = useState<Ticket | null>(null);
  const successTimeoutRef = useRef<number | null>(null);

  function clearSuccessLater() {
    if (successTimeoutRef.current) window.clearTimeout(successTimeoutRef.current);
    successTimeoutRef.current = window.setTimeout(() => setSuccessTicket(null), 15000);
  }

  async function onSubmit(form: HTMLFormElement) {
    const data = new FormData(form);
    const payload: NewTicketPayload = {
      customerName: String(data.get('customerName') ?? ''),
      email: String(data.get('email') ?? ''),
      subject: String(data.get('subject') ?? ''),
      description: String(data.get('description') ?? ''),
    };

    setSubmitting(true);
    setError(null);
    setSuccessTicket(null);
    try {
      const ticket = await createTicket(payload);
      setSuccessTicket(ticket);
      clearSuccessLater();
      form.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit ticket.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold">Ticket submission</h2>
      <p className="mt-1 text-sm text-zinc-600">All fields are required. Triage runs automatically on submit.</p>

      <form
        className="mt-4 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit(e.currentTarget);
        }}
      >
        <SuccessBanner ticket={successTicket} />

        <Field label="Customer name">
          <input
            name="customerName"
            required
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none ring-0 focus:border-zinc-400"
            placeholder="Jane Doe"
          />
        </Field>
        <Field label="Email">
          <input
            name="email"
            type="email"
            required
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none ring-0 focus:border-zinc-400"
            placeholder="jane@example.com"
          />
        </Field>
        <Field label="Subject">
          <input
            name="subject"
            required
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none ring-0 focus:border-zinc-400"
            placeholder="Short summary of the issue"
          />
        </Field>
        <Field label="Description">
          <textarea
            name="description"
            required
            rows={5}
            className="w-full resize-y rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none ring-0 focus:border-zinc-400"
            placeholder="Describe the issue in detail…"
          />
        </Field>

        <button
          type="submit"
          disabled={submitting}
          className="mt-2 inline-flex items-center justify-center gap-2 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? (
            <>
              <Loader size="sm" className="border-zinc-500 border-t-white" />
              <span>Submitting… (running triage)</span>
            </>
          ) : (
            'Submit ticket'
          )}
        </button>

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        ) : null}
      </form>
    </section>
  );
}

function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium text-zinc-800">{props.label}</span>
      {props.children}
    </label>
  );
}
