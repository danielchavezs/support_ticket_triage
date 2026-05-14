'server-only';

/**
 * AI Provider — single-method adapter for Gemini-driven ticket classification.
 *
 * The Provider is intentionally narrow: one method, `classifyTicket`, that
 * calls Gemini through the Vercel AI SDK and returns the structured object
 * generated for the Feature-owned schema supplied by the caller. Errors
 * propagate raw (the Feature layer normalizes per `AGENTS.md` §6).
 *
 * Schema enforcement happens at the SDK boundary via `generateObject`, but
 * the schema itself remains in the Feature layer to preserve the repository's
 * dependency direction: Features may depend on Providers, Providers must not
 * depend on Features.
 */

import { generateObject } from 'ai';
import type { z } from 'zod';

import { getTriageModel } from '@/services/providers/ai/client';

export type AiProvider = {
  classifyTicket: <T>(input: {
    subject: string;
    description: string;
    schema: z.ZodType<T>;
  }) => Promise<T>;
};

const SYSTEM_PROMPT = `You classify customer-support tickets for an internal Airiam product.
Read the subject and description below, then return strictly the JSON object
matching the provided schema.

Guidance:
- "type" describes what the ticket is about (bug, feature, improvement, question, incident).
- "severity" describes how bad the impact is (blocker, major, minor, trivial).
  Use "blocker" only when work is fully stopped or data is at risk.
- "customer_facing_summary": one or two sentences a non-technical user would
  understand; no internal jargon, no PII reproduction.
- "suggested_reply": a short, polite acknowledgement the user could send to
  the submitter; do not promise timelines or escalation.
- "confidence": your self-rated confidence in the classification (0..1).`;

export const ai: AiProvider = {
  async classifyTicket({ subject, description, schema }) {
    const model = getTriageModel();
    const result = await generateObject({
      model,
      schema,
      system: SYSTEM_PROMPT,
      prompt: `Subject:\n${subject}\n\nDescription:\n${description}`,
    });
    return result.object;
  },
};
