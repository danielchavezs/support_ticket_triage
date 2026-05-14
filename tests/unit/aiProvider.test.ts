import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockedFunction } from 'vitest';

import { ai } from '@/services/providers/ai';
import { DEFAULT_MODEL_ID, getTriageModel } from '@/services/providers/ai/client';
import { generateObject } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';

vi.mock('ai', () => ({
  generateObject: vi.fn(),
}));

vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: vi.fn(() => {
    const factory = vi.fn((modelId: string) => ({ modelId, fake: true }));
    return factory;
  }),
}));

const ENV_BACKUP = {
  GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
  AI_MODEL: process.env.AI_MODEL,
};

const TestClassificationSchema = z.object({
  type: z.enum(['bug', 'feature', 'improvement', 'question', 'incident']),
  severity: z.enum(['blocker', 'major', 'minor', 'trivial']),
  customer_facing_summary: z.string(),
  suggested_reply: z.string(),
  confidence: z.number(),
});

describe('getTriageModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.AI_MODEL;
  });

  afterEach(() => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = ENV_BACKUP.GOOGLE_GENERATIVE_AI_API_KEY;
    process.env.GOOGLE_API_KEY = ENV_BACKUP.GOOGLE_API_KEY;
    process.env.AI_MODEL = ENV_BACKUP.AI_MODEL;
  });

  it('throws when no API key is set', () => {
    expect(() => getTriageModel()).toThrow(/GOOGLE_GENERATIVE_AI_API_KEY/);
  });

  it('reads GOOGLE_GENERATIVE_AI_API_KEY and uses the default model', () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'primary-key';

    getTriageModel();

    expect(createGoogleGenerativeAI).toHaveBeenCalledWith({ apiKey: 'primary-key' });
    const factory = (createGoogleGenerativeAI as unknown as MockedFunction<typeof createGoogleGenerativeAI>).mock.results[0]
      .value as ReturnType<typeof createGoogleGenerativeAI>;
    expect(factory).toHaveBeenCalledWith(DEFAULT_MODEL_ID);
  });

  it('falls back to GOOGLE_API_KEY when GOOGLE_GENERATIVE_AI_API_KEY is unset', () => {
    process.env.GOOGLE_API_KEY = 'legacy-key';

    getTriageModel();

    expect(createGoogleGenerativeAI).toHaveBeenCalledWith({ apiKey: 'legacy-key' });
  });

  it('honors AI_MODEL when provided', () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'primary-key';
    process.env.AI_MODEL = 'gemini-1.5-pro';

    getTriageModel();

    const factory = (createGoogleGenerativeAI as unknown as MockedFunction<typeof createGoogleGenerativeAI>).mock.results[0]
      .value as ReturnType<typeof createGoogleGenerativeAI>;
    expect(factory).toHaveBeenCalledWith('gemini-1.5-pro');
  });

  it('treats blank AI_MODEL as unset and falls back to the default', () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'primary-key';
    process.env.AI_MODEL = '   ';

    getTriageModel();

    const factory = (createGoogleGenerativeAI as unknown as MockedFunction<typeof createGoogleGenerativeAI>).mock.results[0]
      .value as ReturnType<typeof createGoogleGenerativeAI>;
    expect(factory).toHaveBeenCalledWith(DEFAULT_MODEL_ID);
  });
});

describe('ai.classifyTicket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test-key';
  });

  afterEach(() => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = ENV_BACKUP.GOOGLE_GENERATIVE_AI_API_KEY;
  });

  it('calls generateObject with the configured model + schema and returns the parsed object', async () => {
    const generateObjectMock = generateObject as unknown as MockedFunction<typeof generateObject>;
    const classification = {
      type: 'bug' as const,
      severity: 'major' as const,
      customer_facing_summary: 'Cannot log in.',
      suggested_reply: 'Thanks — investigating.',
      confidence: 0.88,
    };
    generateObjectMock.mockResolvedValue({ object: classification } as unknown as Awaited<ReturnType<typeof generateObject>>);

    const result = await ai.classifyTicket({
      subject: 'SSO broken',
      description: 'Redirect loop.',
      schema: TestClassificationSchema,
    });

    expect(generateObjectMock).toHaveBeenCalledTimes(1);
    const callArg = generateObjectMock.mock.calls[0][0] as {
      model: unknown;
      schema: unknown;
      system: string;
      prompt: string;
    };
    expect(callArg.system).toContain('classify');
    expect(callArg.prompt).toContain('SSO broken');
    expect(callArg.prompt).toContain('Redirect loop.');
    expect(callArg.schema).toBe(TestClassificationSchema);
    expect(callArg.model).toBeDefined();
    expect(result).toEqual(classification);
  });

  it('propagates SDK errors raw (Feature layer normalizes)', async () => {
    const generateObjectMock = generateObject as unknown as MockedFunction<typeof generateObject>;
    generateObjectMock.mockRejectedValue(new Error('API rate limit'));

    await expect(
      ai.classifyTicket({ subject: 'x', description: 'y', schema: TestClassificationSchema }),
    ).rejects.toThrow('API rate limit');
  });
});
