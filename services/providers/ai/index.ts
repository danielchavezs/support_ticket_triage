'server-only';

/**
 * AI Provider — adapter for ticket classification (Gemini) and vector
 * embedding (OpenAI).
 *
 * The Provider stays narrow: each method maps 1:1 to an underlying SDK call.
 * Schemas (for classification) and validation (for embedding dimension) live
 * in the Feature layer or here as small invariants; the Provider itself never
 * depends on Feature-layer types.
 *
 * Phase 3.5 adds `classifyTicketWithTools<T>` alongside the existing
 * single-shot `classifyTicket<T>`. The tool-loop variant exposes the AI SDK's
 * `generateText` + `Output.object` + `stopWhen` surface to the Feature layer
 * without leaking SDK types upstream; the schema, the `ToolSet`, and the loop
 * budget are all caller-supplied. The Provider remains schema-agnostic and
 * does not import from `services/features/`.
 *
 * Errors propagate raw — the Feature layer normalizes them to `FeatureError`
 * per `AGENTS.md` §6.
 */

import {
  embed,
  generateObject,
  generateText,
  Output,
  stepCountIs,
  type StepResult,
  type ToolSet,
} from 'ai';
import type { z } from 'zod';

import { getEmbeddingModel, getTriageModel } from '@/services/providers/ai/client';

export type ClassifyTicketWithToolsResult<T> = {
  result: T;
  steps: StepResult<ToolSet>[];
};

export type AiProvider = {
  classifyTicket: <T>(input: {
    subject: string;
    description: string;
    schema: z.ZodType<T>;
  }) => Promise<T>;
  classifyTicketWithTools: <T>(input: {
    subject: string;
    description: string;
    schema: z.ZodType<T>;
    tools: ToolSet;
    maxSteps: number;
    timeoutMs?: number;
  }) => Promise<ClassifyTicketWithToolsResult<T>>;
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
- "confidence": your self-rated confidence in the classification (0..1).

Tool use (Phase 3.5):
- When tools are available, they are read-only helpers for grounding your
  judgement in this org's local context (similar past tickets, the
  submitter's recent history). Tool results are advisory, not exhaustive —
  do not assume an empty result means no such ticket exists.
- Use a tool only when the subject or description is ambiguous and local
  context could change your answer. If you are already confident, produce
  the schema directly with zero tool calls.
- Never assume tool outputs are exhaustive, and never invoke a tool more
  than necessary; the loop budget is finite.`;

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

  async classifyTicketWithTools({
    subject,
    description,
    schema,
    tools,
    maxSteps,
    timeoutMs,
  }) {
    const model = getTriageModel();
    const result = await generateText({
      model,
      system: SYSTEM_PROMPT,
      prompt: `Subject:\n${subject}\n\nDescription:\n${description}`,
      tools,
      stopWhen: stepCountIs(maxSteps),
      output: Output.object({ schema }),
      ...(timeoutMs !== undefined ? { timeout: timeoutMs } : {}),
    });
    return { result: result.output, steps: result.steps };
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
