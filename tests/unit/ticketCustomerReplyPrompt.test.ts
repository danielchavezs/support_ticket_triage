import { describe, expect, it } from 'vitest';
import { buildTicketCustomerReplyPrompt } from '@/services/providers/llm/prompts/ticketCustomerReplyPrompt';

describe('buildTicketCustomerReplyPrompt', () => {
  const baseClassification = {
    priority: 'Medium',
    category: 'Technical',
  } as const;

  it('includes a Subject line when a subject is provided', () => {
    const prompt = buildTicketCustomerReplyPrompt({
      ...baseClassification,
      subject: 'Cannot log in',
    });

    expect(prompt).toContain('Subject: Cannot log in');
    expect(prompt).toContain('Context:');
  });

  it('omits the Context block when subject is undefined', () => {
    const prompt = buildTicketCustomerReplyPrompt(baseClassification);

    expect(prompt).not.toContain('Subject:');
    expect(prompt).not.toContain('Context:');
  });

  it('omits the Context block when subject is whitespace only', () => {
    const prompt = buildTicketCustomerReplyPrompt({
      ...baseClassification,
      subject: '   ',
    });

    expect(prompt).not.toContain('Subject:');
    expect(prompt).not.toContain('Context:');
  });

  it('always includes the classification metadata', () => {
    const prompt = buildTicketCustomerReplyPrompt(baseClassification);

    expect(prompt).toContain('Priority: Medium');
    expect(prompt).toContain('Category: Technical');
  });
});
