'server-only';

/**
 * Server-side Supabase Provider wiring.
 *
 * Wires the admin (service-role / secret-key) client so server-to-server
 * paths can bypass RLS and use explicit `org_id` predicates in Provider
 * methods for cross-org isolation. See architecture doc § Data Layer for
 * the dual-responsibility rationale (RLS for future user-JWT paths;
 * explicit scoping for service-role paths today).
 */

import { createAdminClient } from '@/services/providers/supabase/clients/admin';
import { makeTickets, type TicketsSource } from '@/services/providers/supabase/domains/tickets';
import { makeOrgs, type OrgsSource } from '@/services/providers/supabase/domains/orgs';
import { makeUsers, type UsersSource } from '@/services/providers/supabase/domains/users';
import { makeTicketEvents, type TicketEventsSource } from '@/services/providers/supabase/domains/ticketEvents';

export type ServerSources = {
  tickets: TicketsSource;
  orgs: OrgsSource;
  users: UsersSource;
  ticketEvents: TicketEventsSource;
};

export function wireServer(): ServerSources {
  const getClient = async () => createAdminClient();
  return {
    tickets: makeTickets(getClient),
    orgs: makeOrgs(getClient),
    users: makeUsers(getClient),
    ticketEvents: makeTicketEvents(getClient),
  };
}

export const server = wireServer();
