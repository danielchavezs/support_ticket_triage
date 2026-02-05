'server-only';

import { z } from 'zod';

import type { TicketCategory, TicketPriority } from '@/services/sources/supabase/domains/tickets';

export const priorities = ['Critical', 'High', 'Medium', 'Low'] as const satisfies readonly TicketPriority[];
export const categories = ['Billing', 'Technical', 'Account', 'General'] as const satisfies readonly TicketCategory[];

export const TicketClassificationSchema = z.object({
  priority: z.enum(priorities),
  category: z.enum(categories),
});

export type TicketClassification = z.infer<typeof TicketClassificationSchema>;

export const TicketCustomerReplySchema = z.object({
  customerMessage: z.string().min(1),
});

export type TicketCustomerReply = z.infer<typeof TicketCustomerReplySchema>;

