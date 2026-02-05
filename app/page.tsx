import TicketSubmitClient from '@/components/tickets/TicketSubmitClient';
import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-10 sm:px-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">New support ticket</h1>
          <p className="text-zinc-600">Submit a ticket to run automatic triage and generate a suggested response.</p>
          <div className="mt-1 text-sm">
            <Link href="/dashboard" className="font-medium text-zinc-900 underline underline-offset-4">
              View dashboard
            </Link>
          </div>
        </header>

        <TicketSubmitClient />
      </main>
    </div>
  );
}
