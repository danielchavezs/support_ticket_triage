'server-only';

/**
 * Server-side Gemini model factory.
 *
 * Reads env at call time (not import time) so the module can be imported in
 * contexts where the API key may not yet be loaded — for example, Next.js
 * build steps that traverse modules statically. The factory throws if the
 * key is missing when classification is actually attempted, mirroring the
 * Supabase admin client pattern.
 */

import { createGoogleGenerativeAI } from '@ai-sdk/google';

export const DEFAULT_MODEL_ID = 'gemini-2.5-flash-lite';

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
