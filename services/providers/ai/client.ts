'server-only';

/**
 * Server-side AI model factories.
 *
 * Two distinct provider integrations live here:
 *   - `getTriageModel()`     — Gemini, for structured ticket classification
 *                              (Phase 2). Uses `@ai-sdk/google`.
 *   - `getEmbeddingModel()`  — OpenAI, for `text-embedding-3-large` truncated
 *                              to 1536 dims (Phase 3, BL-007). Uses
 *                              `@ai-sdk/openai`.
 *
 * Both factories read env at call time (not import time) so this module can
 * be imported in contexts where the API key may not yet be loaded — e.g.,
 * Next.js build steps that traverse modules statically. Each throws with a
 * clear error if its key is missing when actually invoked.
 */

import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';

export const DEFAULT_MODEL_ID = 'gemini-2.5-flash-lite';
export const DEFAULT_EMBEDDING_MODEL_ID = 'text-embedding-3-large';
export const DEFAULT_EMBEDDING_DIMENSIONS = 1536;

export function getTriageModel() {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error(
      'Missing env var: GOOGLE_GENERATIVE_AI_API_KEY (fallback: GOOGLE_API_KEY).',
    );
  }

  const provider = createGoogleGenerativeAI({ apiKey });
  const modelId = process.env.AI_MODEL?.trim() || DEFAULT_MODEL_ID;
  return provider(modelId);
}

/**
 * Build the OpenAI embedding model used by Phase 3 vector dedup.
 *
 * Honors two optional env overrides:
 *   - `AI_EMBEDDING_MODEL`       — defaults to `text-embedding-3-large`.
 *   - `AI_EMBEDDING_DIMENSIONS`  — defaults to 1536. Must fit the column
 *                                  type (`vector(1536)`) until the
 *                                  `halfvec(3072)` fallback is taken.
 *
 * The `@ai-sdk/openai` v3 surface no longer accepts `dimensions` on the model
 * factory itself; it is passed at call time via `embed()`'s `providerOptions`
 * (see `ai.generateEmbedding`). We return the configured dimensions here so
 * the caller has a single source of truth for both the request and the
 * length-validation step.
 */
export function getEmbeddingModel(): {
  model: ReturnType<ReturnType<typeof createOpenAI>['embedding']>;
  dimensions: number;
} {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing env var: OPENAI_API_KEY.');
  }

  const modelId = process.env.AI_EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL_ID;
  const dimensions = parseDimensions(process.env.AI_EMBEDDING_DIMENSIONS) ?? DEFAULT_EMBEDDING_DIMENSIONS;

  const provider = createOpenAI({ apiKey });
  const model = provider.embedding(modelId);
  return { model, dimensions };
}

function parseDimensions(raw: string | undefined): number | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `Invalid env var AI_EMBEDDING_DIMENSIONS: "${raw}" (must be a positive integer).`,
    );
  }
  return parsed;
}
