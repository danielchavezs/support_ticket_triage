'server-only';

import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateObject, type LanguageModel } from 'ai';

import { buildTicketClassificationPrompt } from '@/services/sources/llm/prompts/ticketClassificationPrompt';
import { buildTicketCustomerReplyPrompt } from '@/services/sources/llm/prompts/ticketCustomerReplyPrompt';
import {
  TicketClassificationSchema,
  TicketCustomerReplySchema,
  type TicketClassification,
  type TicketCustomerReply,
} from '@/services/sources/llm/ticketTriageSchemas';

function getGoogleModel(): LanguageModel {
  const modelId = process.env.AI_MODEL ?? 'gemini-2.5-flash-lite';
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GOOGLE_API_KEY;

  if (!apiKey) {
    throw new Error('Missing env var: GOOGLE_GENERATIVE_AI_API_KEY (or GOOGLE_API_KEY)');
  }

  const google = createGoogleGenerativeAI({ apiKey });
  return google(modelId) as unknown as LanguageModel;
}

export async function classifyTicketWithLlm(input: {
  subject: string;
  description: string;
}): Promise<TicketClassification> {
  const prompt = buildTicketClassificationPrompt(input);

  const result = await generateObject({
    model: getGoogleModel(),
    schema: TicketClassificationSchema,
    prompt,
    temperature: 0,
  });

  return result.object;
}

export async function draftCustomerReplyWithLlm(
  input: TicketClassification & { subject?: string },
): Promise<TicketCustomerReply> {
  const prompt = buildTicketCustomerReplyPrompt(input);

  const result = await generateObject({
    model: getGoogleModel(),
    schema: TicketCustomerReplySchema,
    prompt,
    temperature: 0.2,
  });

  return result.object;
}
