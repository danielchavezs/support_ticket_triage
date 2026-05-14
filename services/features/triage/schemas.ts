/**
 * Zod schemas for triage Feature inputs and LLM outputs.
 *
 * `TriageClassificationSchema` is the contract for the AI Provider's
 * structured output. It is enforced twice: once at the SDK boundary
 * (`generateObject` receives the same schema) and once at the Feature
 * boundary as a defense-in-depth re-parse before the row is persisted.
 *
 * The enum value lists are duplicated here as `as const` tuples (instead of
 * being imported from the generated `Database` types) because Zod 4's
 * `z.enum` requires a literal tuple at type-check time. The TS-level
 * assertions below ensure these lists stay in lockstep with the Postgres
 * enum values defined in `migrations/2026-05-13_02_create_enums.sql`.
 */

import { z } from 'zod';
import type {
  TicketSeverity,
  TicketType,
} from '@/services/providers/supabase/domains/tickets';

export const TICKET_TYPE_VALUES = ['bug', 'feature', 'improvement', 'question', 'incident'] as const;
export const TICKET_SEVERITY_VALUES = ['blocker', 'major', 'minor', 'trivial'] as const;

// Compile-time guarantee that the local tuples and DB enums stay in lockstep.
type MissingTicketType = Exclude<TicketType, (typeof TICKET_TYPE_VALUES)[number]>;
type ExtraTicketType = Exclude<(typeof TICKET_TYPE_VALUES)[number], TicketType>;
type MissingTicketSeverity = Exclude<TicketSeverity, (typeof TICKET_SEVERITY_VALUES)[number]>;
type ExtraTicketSeverity = Exclude<(typeof TICKET_SEVERITY_VALUES)[number], TicketSeverity>;

const _typeValuesCoverDbEnum: MissingTicketType extends never ? true : never = true;
const _typeValuesMatchDbEnum: ExtraTicketType extends never ? true : never = true;
const _severityValuesCoverDbEnum: MissingTicketSeverity extends never ? true : never = true;
const _severityValuesMatchDbEnum: ExtraTicketSeverity extends never ? true : never = true;
void _typeValuesCoverDbEnum;
void _typeValuesMatchDbEnum;
void _severityValuesCoverDbEnum;
void _severityValuesMatchDbEnum;

export const TriageClassificationSchema = z.object({
  type: z.enum(TICKET_TYPE_VALUES),
  severity: z.enum(TICKET_SEVERITY_VALUES),
  customer_facing_summary: z.string().min(1, 'customer_facing_summary is required.'),
  suggested_reply: z.string().min(1, 'suggested_reply is required.'),
  confidence: z.number().min(0).max(1),
});

export type TriageClassification = z.infer<typeof TriageClassificationSchema>;
