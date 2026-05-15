import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockedFunction } from 'vitest';

import { ai, EmbeddingDimensionMismatchError } from '@/services/providers/ai';
import {
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_MODEL_ID,
  DEFAULT_MODEL_ID,
  getEmbeddingModel,
  getTriageModel,
} from '@/services/providers/ai/client';
import { embed, generateObject } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';

vi.mock('ai', () => ({
  embed: vi.fn(),
  generateObject: vi.fn(),
}));

vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: vi.fn(() => {
    const factory = vi.fn((modelId: string) => ({ modelId, fake: true }));
    return factory;
  }),
}));

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => {
    const embeddingFactory = vi.fn((modelId: string) => ({ modelId, fake: true }));
    return { embedding: embeddingFactory };
  }),
}));

const ENV_BACKUP = {
  GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
  AI_MODEL: process.env.AI_MODEL,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  AI_EMBEDDING_MODEL: process.env.AI_EMBEDDING_MODEL,
  AI_EMBEDDING_DIMENSIONS: process.env.AI_EMBEDDING_DIMENSIONS,
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

describe('getEmbeddingModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.OPENAI_API_KEY;
    delete process.env.AI_EMBEDDING_MODEL;
    delete process.env.AI_EMBEDDING_DIMENSIONS;
  });

  afterEach(() => {
    process.env.OPENAI_API_KEY = ENV_BACKUP.OPENAI_API_KEY;
    process.env.AI_EMBEDDING_MODEL = ENV_BACKUP.AI_EMBEDDING_MODEL;
    process.env.AI_EMBEDDING_DIMENSIONS = ENV_BACKUP.AI_EMBEDDING_DIMENSIONS;
  });

  it('throws when OPENAI_API_KEY is not set', () => {
    expect(() => getEmbeddingModel()).toThrow(/OPENAI_API_KEY/);
  });

  it('reads OPENAI_API_KEY and uses the default model + dimensions', () => {
    process.env.OPENAI_API_KEY = 'sk-test';

    const { dimensions } = getEmbeddingModel();

    expect(createOpenAI).toHaveBeenCalledWith({ apiKey: 'sk-test' });
    const factory = (createOpenAI as unknown as MockedFunction<typeof createOpenAI>).mock.results[0]
      .value as { embedding: MockedFunction<(id: string) => unknown> };
    expect(factory.embedding).toHaveBeenCalledWith(DEFAULT_EMBEDDING_MODEL_ID);
    expect(dimensions).toBe(DEFAULT_EMBEDDING_DIMENSIONS);
  });

  it('honors AI_EMBEDDING_MODEL and AI_EMBEDDING_DIMENSIONS overrides', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.AI_EMBEDDING_MODEL = 'text-embedding-3-small';
    process.env.AI_EMBEDDING_DIMENSIONS = '768';

    const { dimensions } = getEmbeddingModel();

    const factory = (createOpenAI as unknown as MockedFunction<typeof createOpenAI>).mock.results[0]
      .value as { embedding: MockedFunction<(id: string) => unknown> };
    expect(factory.embedding).toHaveBeenCalledWith('text-embedding-3-small');
    expect(dimensions).toBe(768);
  });

  it('rejects an invalid AI_EMBEDDING_DIMENSIONS value', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.AI_EMBEDDING_DIMENSIONS = 'not-a-number';

    expect(() => getEmbeddingModel()).toThrow(/AI_EMBEDDING_DIMENSIONS/);
  });
});

describe('ai.generateEmbedding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = 'sk-test';
    delete process.env.AI_EMBEDDING_DIMENSIONS;
    delete process.env.AI_EMBEDDING_MODEL;
  });

  afterEach(() => {
    process.env.OPENAI_API_KEY = ENV_BACKUP.OPENAI_API_KEY;
  });

  it('returns the SDK embedding when the dimension matches the configured value', async () => {
    const embedMock = embed as unknown as MockedFunction<typeof embed>;
    const expected = Array.from({ length: DEFAULT_EMBEDDING_DIMENSIONS }, (_, i) => i / DEFAULT_EMBEDDING_DIMENSIONS);
    embedMock.mockResolvedValue({ embedding: expected } as unknown as Awaited<ReturnType<typeof embed>>);

    const result = await ai.generateEmbedding('My printer is broken.');

    expect(embedMock).toHaveBeenCalledTimes(1);
    const callArg = embedMock.mock.calls[0][0] as {
      model: unknown;
      value: string;
      providerOptions: { openai: { dimensions: number } };
    };
    expect(callArg.value).toBe('My printer is broken.');
    expect(callArg.model).toBeDefined();
    expect(callArg.providerOptions).toEqual({ openai: { dimensions: DEFAULT_EMBEDDING_DIMENSIONS } });
    expect(result).toEqual(expected);
  });

  it('throws EmbeddingDimensionMismatchError when the SDK returns the wrong length', async () => {
    const embedMock = embed as unknown as MockedFunction<typeof embed>;
    embedMock.mockResolvedValue({ embedding: [0.1, 0.2, 0.3] } as unknown as Awaited<ReturnType<typeof embed>>);

    await expect(ai.generateEmbedding('foo')).rejects.toBeInstanceOf(EmbeddingDimensionMismatchError);
  });

  it('propagates SDK errors raw (Feature layer normalizes)', async () => {
    const embedMock = embed as unknown as MockedFunction<typeof embed>;
    embedMock.mockRejectedValue(new Error('OpenAI rate limit'));

    await expect(ai.generateEmbedding('foo')).rejects.toThrow('OpenAI rate limit');
  });
});
