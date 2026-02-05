'server-only';

import { createServerClient } from '@/services/sources/supabase/clients/server';
import { makeTickets, type TicketsSource } from '@/services/sources/supabase/domains/tickets';

export type ServerSources = {
  tickets: TicketsSource;
};

export function wireServer(): ServerSources {
  const getClient = async () => await createServerClient();
  return {
    tickets: makeTickets(getClient),
  };
}

export const server = wireServer();

