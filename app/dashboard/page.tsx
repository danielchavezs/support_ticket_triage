import TicketDashboardClient from '@/components/tickets/TicketDashboardClient';
import Link from 'next/link';

export default function DashboardPage() {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-10 sm:px-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">Tickets dashboard</h1>
          <p className="text-zinc-600">Review submitted tickets and their AI-generated triage metadata.</p>
          <div className="mt-1 text-sm">
            <Link href="/" className="font-medium text-zinc-900 underline underline-offset-4">
              Submit a new ticket
            </Link>
          </div>
        </header>

        <TicketDashboardClient />
      </main>
    </div>
  );
}
