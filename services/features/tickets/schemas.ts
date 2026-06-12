/**
 * Zod schemas for the tickets Feature inputs.
 *
 * Validation happens at the Feature boundary, not at the API/transport edge:
 * the route handler trusts the Feature to enforce these rules and only maps
 * outcomes to HTTP status codes.
 */

import { z } from 'zod';

/**
 * UUID validator — accepts any UUID-shaped string (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
 * in hex). Intentionally permissive: we accept nil and nil-adjacent UUIDs
 * (used by the dev-seed defaults), not just RFC 4122 v1–v8 with strict
 * version bits. Postgres `uuid` columns enforce the canonical format at the
 * DB layer; this Feature-layer check is sanity-only.
 */
const UuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Must be a valid UUID.');

/**
 * Input shape for creating a ticket. Required: `orgId`, `userId`, `subject`,
 * `description`. Optional: `sourceKind` (defaults to `in_app`).
 *
 * `customerName` and `email` are intentionally NOT here — those fields live
 * on the `users` table and are looked up from `users.org_id + users.id`.
 */
export const NewTicketInputSchema = z.object({
  orgId: UuidSchema,
  userId: UuidSchema,
  subject: z.string().trim().min(1, 'Subject is required.'),
  description: z.string().trim().min(1, 'Description is required.'),
  sourceKind: z.enum(['in_app', 'aip_monitoring']).optional(),
});

export type NewTicketInput = z.infer<typeof NewTicketInputSchema>;

/**
 * Input for `listTicketsFeature` and `retryTicketTriageFeature`. Just the
 * org reference (plus the ticket reference for retry).
 */
export const OrgScopedInputSchema = z.object({
  orgId: UuidSchema,
});

export const TicketScopedInputSchema = z.object({
  orgId: UuidSchema,
  ticketId: UuidSchema,
});
