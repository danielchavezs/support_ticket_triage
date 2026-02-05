'server-only';

import { categories, priorities } from '@/services/sources/llm/ticketTriageSchemas';

export function buildTicketClassificationPrompt(input: {
  subject: string;
  description: string;
}): string {
  return [
    'Classify the support ticket.',
    '',
    `Priority must be one of: ${priorities.join(', ')}`,
    `Category must be one of: ${categories.join(', ')}`,
    '',
    'Return ONLY valid JSON that matches this schema:',
    '{ "priority": "...", "category": "..." }',
    '',
    'Ticket:',
    `Subject: ${input.subject}`,
    `Description: ${input.description}`,
  ].join('\n');
}

