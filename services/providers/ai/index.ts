'server-only';

/**
 * AI Provider — two-method adapter for ticket classification (Gemini) and
 * vector embedding (OpenAI).
 *
 * The Provider stays narrow: each method maps 1:1 to an underlying SDK call.
 * Schemas (for classification) and validation (for embedding dimension) live
 * in the Feature layer or here as small invariants; the Provider itself never
 * depends on Feature-layer types.
 *
 * Errors propagate raw — the Feature layer normalizes them to `FeatureError`
 * per `AGENTS.md` §6.
 */

import { embed, generateObject } from 'ai';
import type { z } from 'zod';

import { getEmbeddingModel, getTriageModel } from '@/services/providers/ai/client';

export type AiProvider = {
  classifyTicket: <T>(input: {
    subject: string;
    description: string;
    schema: z.ZodType<T>;
  }) => Promise<T>;
  generateEmbedding: (text: string) => Promise<number[]>;
};

export class EmbeddingDimensionMismatchError extends Error {
  readonly code = 'EMBEDDING_DIMENSION_MISMATCH';
  constructor(public expected: number, public actual: number) {
    super(`Embedding dimension mismatch: expected ${expected}, got ${actual}.`);
    this.name = 'EmbeddingDimensionMismatchError';
  }
}

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

  async generateEmbedding(text) {
    const { model, dimensions } = getEmbeddingModel();
    const result = await embed({
      model,
      value: text,
      providerOptions: { openai: { dimensions } },
    });
    if (result.embedding.length !== dimensions) {
      throw new EmbeddingDimensionMismatchError(dimensions, result.embedding.length);
    }
    return result.embedding;
  },
};
