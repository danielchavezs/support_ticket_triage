import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockedFunction } from 'vitest';
import { classifyTicketWithLlm, draftCustomerReplyWithLlm } from '@/services/sources/llm/ticketTriage';
import { generateObject } from 'ai';
import type { GenerateObjectResult } from 'ai';

// Mock the AI SDK
vi.mock('ai', () => ({
    generateObject: vi.fn(),
}));

vi.mock('@ai-sdk/google', () => ({
    createGoogleGenerativeAI: vi.fn(() => vi.fn()),
}));

describe('ticketTriage sources', () => {
    const originalEnv = process.env;
    const generateObjectMock = generateObject as unknown as MockedFunction<typeof generateObject>;

    beforeEach(() => {
        vi.clearAllMocks();
        process.env = { ...originalEnv, GOOGLE_API_KEY: 'test-key' };
    });

    it('classifyTicketWithLlm returns classification from LLM', async () => {
        const mockClassification = {
            priority: 'Critical',
            category: 'Technical',
        } as const;

        generateObjectMock.mockResolvedValue({
            object: mockClassification,
            finishReason: 'stop',
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
            warnings: undefined,
            rawResponse: { headers: {} },
        } as unknown as GenerateObjectResult<typeof mockClassification>);

        const result = await classifyTicketWithLlm({
            subject: 'Server down',
            description: 'The production server is completely unresponsive.',
        });

        expect(result).toEqual(mockClassification);
        expect(generateObject).toHaveBeenCalled();
    });

    it('draftCustomerReplyWithLlm returns a customer message from LLM', async () => {
        const mockReply = { customerMessage: 'Thanks for reaching out. We are reviewing this now.' };

        generateObjectMock.mockResolvedValue({
            object: mockReply,
            finishReason: 'stop',
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
            warnings: undefined,
            rawResponse: { headers: {} },
        } as unknown as GenerateObjectResult<typeof mockReply>);

        const result = await draftCustomerReplyWithLlm({
            priority: 'High',
            category: 'Account',
            subject: 'Unauthorized access',
        });

        expect(result).toEqual(mockReply);
        expect(generateObject).toHaveBeenCalled();
    });

    it('throws error when API key is missing', async () => {
        delete process.env.GOOGLE_API_KEY;
        delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

        await expect(
            classifyTicketWithLlm({
                subject: 'Test',
                description: 'Test',
            })
        ).rejects.toThrow('Missing env var');

        await expect(
            draftCustomerReplyWithLlm({
                priority: 'Low',
                category: 'General',
                subject: 'Test',
            })
        ).rejects.toThrow('Missing env var');
    });

    it('propagates errors from generateObject', async () => {
        generateObjectMock.mockRejectedValue(new Error('AI SDK Error'));

        await expect(
            classifyTicketWithLlm({
                subject: 'Test',
                description: 'Test',
            })
        ).rejects.toThrow('AI SDK Error');
    });
});
