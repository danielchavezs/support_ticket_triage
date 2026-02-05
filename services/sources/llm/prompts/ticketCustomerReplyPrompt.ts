'server-only';

import type { TicketClassification } from '@/services/sources/llm/ticketTriageSchemas';

export function buildTicketCustomerReplyPrompt(input: TicketClassification & { subject?: string }): string {
  const subjectLine = input.subject?.trim() ? `Subject: ${input.subject.trim()}` : null;

  return [
    'Draft a short customer-facing acknowledgement message for a support ticket.',
    '',
    'Constraints:',
    '- Do NOT include any timelines or promises (no SLAs, no "within X hours/days").',
    '- Do NOT claim that an investigation is complete or that you confirmed facts you cannot know.',
    '- Do NOT mention policies, internal processes, or that you are an AI.',
    '- Be concise, professional, and helpful.',
    '',
    'Use the provided classification to adjust tone:',
    '- Critical: urgent, reassure immediate attention and escalation (without timelines).',
    '- High: serious, emphasize investigation and security/impact awareness (without timelines).',
    '- Medium: clear next steps and request needed info (without timelines).',
    '- Low: friendly, informative, and lightweight.',
    '',
    'Return ONLY valid JSON that matches this schema:',
    '{ "customerMessage": "..." }',
    '',
    'Classification:',
    `Priority: ${input.priority}`,
    `Category: ${input.category}`,
    ...(subjectLine ? ['', 'Context:', subjectLine] : []),
  ].join('\n');
}

