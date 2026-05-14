// v1 client-side types. Mirrors the camelCase DTO returned by the API
// route handlers (see app/api/tickets/route.ts).
//
// Triage fields (`type`, `severity`, `priority`, `confidence`,
// `customerFacingSummary`, `suggestedReply`) are nullable; they remain null
// in Phase 1 until Phase 2's triage Feature backfills them.

export type TicketType = 'bug' | 'feature' | 'improvement' | 'question' | 'incident';
export type TicketSeverity = 'blocker' | 'major' | 'minor' | 'trivial';
export type TicketPriority = 'P1' | 'P2' | 'P3' | 'P4';
export type TicketStatus =
  | 'received'
  | 'triaged'
  | 'duplicate'
  | 'pushed_to_linear'
  | 'failed'
  | 'closed';
export type TicketSourceKind = 'in_app' | 'aip_monitoring';

export type Ticket = {
  id: string;
  createdAt: string;
  updatedAt: string;
  orgId: string;
  userId: string;
  sourceKind: TicketSourceKind;
  subject: string;
  description: string;
  type: TicketType | null;
  severity: TicketSeverity | null;
  priority: TicketPriority | null;
  confidence: number | null;
  customerFacingSummary: string | null;
  suggestedReply: string | null;
  status: TicketStatus;
  triageError: string | null;
  linearIssueId: string | null;
};

/**
 * Form-side payload for submitting a new ticket from the dashboard.
 *
 * Just the free-text fields the user types. The client `createTicket`
 * helper layers `orgId` and `userId` on top from the dev-default env vars
 * before hitting the API. Phase 7 (caller auth) replaces those env reads
 * with real cryptographic caller identification.
 */
export type NewTicketPayload = {
  subject: string;
  description: string;
};

export type ApiError = { code: string; message: string };
