import { fail, ok, type FeatureResult } from '@/services/features/types';
import { server as sources } from '@/services/sources/supabase/server';
import { classifyTicketWithLlm, draftCustomerReplyWithLlm } from '@/services/sources/llm/ticketTriage';
import { isValidEmail } from '@/services/features/tickets/validation';
import type {
  NewTicketRow,
  TicketCategory,
  TicketPriority,
  TicketRow,
} from '@/services/sources/supabase/domains/tickets';

export type NewTicketInput = {
  customerName: string;
  email: string;
  subject: string;
  description: string;
};

export type TriageOutput = {
  priority: TicketPriority;
  category: TicketCategory;
  suggestedResponse: string;
};

export async function listTicketsFeature(): Promise<FeatureResult<TicketRow[]>> {
  try {
    const tickets = await sources.tickets.list();
    return ok(tickets);
  } catch {
    return fail('TICKETS_LIST_FAILED', 'Failed to fetch tickets.');
  }
}

export async function createTicketFeature(input: {
  ticket: NewTicketInput;
}): Promise<FeatureResult<TicketRow>> {
  const validation = validateNewTicketInput(input.ticket);
  if (!validation.success) return validation;

  const ticket = {
    customer_name: input.ticket.customerName.trim(),
    email: input.ticket.email.trim(),
    subject: input.ticket.subject.trim(),
    description: input.ticket.description.trim(),
  };

  const triage = await performTriage({
    subject: ticket.subject,
    description: ticket.description,
  });

  const toInsert: NewTicketRow = {
    ...ticket,
    priority: triage.priority,
    category: triage.category,
    suggested_response: triage.suggestedResponse.trim(),
    triage_status: triage.status,
    triage_error: triage.error,
  };

  try {
    const created = await sources.tickets.create(toInsert);
    return ok(created);
  } catch (dbErr) {
    console.error('Ticket create failed:', dbErr);
    return fail('TICKET_CREATE_FAILED', 'Failed to create ticket.');
  }
}

function validateNewTicketInput(input: NewTicketInput): FeatureResult<never> | { success: true } {
  const customerName = input.customerName?.trim();
  const email = input.email?.trim();
  const subject = input.subject?.trim();
  const description = input.description?.trim();

  if (!customerName) return fail('VALIDATION_ERROR', 'Customer name is required.');
  if (!email) return fail('VALIDATION_ERROR', 'Email is required.');
  if (!subject) return fail('VALIDATION_ERROR', 'Subject is required.');
  if (!description) return fail('VALIDATION_ERROR', 'Description is required.');

  if (!isValidEmail(email)) return fail('VALIDATION_ERROR', 'Email must be a valid email address.');

  return { success: true };
}

export async function retryTicketTriageFeature(input: {
  ticketId: string;
}): Promise<FeatureResult<TicketRow>> {
  let existingTicket: TicketRow | null;
  try {
    existingTicket = await sources.tickets.getById(input.ticketId);
  } catch (err) {
    console.error('Failed to fetch ticket for retry:', err);
    return fail('TICKET_FETCH_FAILED', 'Failed to fetch ticket.');
  }

  if (!existingTicket) {
    return fail('TICKET_NOT_FOUND', 'Ticket not found.');
  }

  const triage = await performTriage({
    subject: existingTicket.subject,
    description: existingTicket.description,
    defaults: {
      priority: existingTicket.priority as TicketPriority,
      category: existingTicket.category as TicketCategory,
      suggestedResponse: existingTicket.suggested_response ?? undefined,
    },
  });

  try {
    const updated = await sources.tickets.updateTriage(input.ticketId, {
      priority: triage.priority,
      category: triage.category,
      suggested_response: triage.suggestedResponse.trim(),
      triage_status: triage.status,
      triage_error: triage.error,
    });
    return ok(updated);
  } catch (dbErr) {
    console.error('Ticket triage update failed:', dbErr);
    return fail('TICKET_UPDATE_FAILED', 'Failed to update ticket triage.');
  }
}

/**
 * Shared helper to perform LLM triage (classification + drafting).
 */
async function performTriage(input: {
  subject: string;
  description: string;
  defaults?: {
    priority: TicketPriority;
    category: TicketCategory;
    suggestedResponse?: string;
  };
}): Promise<TriageOutput & { status: 'succeeded' | 'failed'; error: string | null }> {
  let classificationFailed = false;
  let responseFailed = false;
  let priority: TicketPriority = input.defaults?.priority ?? 'Low';
  let category: TicketCategory = input.defaults?.category ?? 'General';
  let suggestedResponse = '';

  // 1. Classification
  try {
    const classification = await classifyTicketWithLlm({
      subject: input.subject,
      description: input.description,
    });
    priority = classification.priority;
    category = classification.category;
  } catch (err) {
    console.error('LLM classification failed:', err);
    classificationFailed = true;
  }

  // 2. Response Drafting
  try {
    const drafted = await draftCustomerReplyWithLlm({
      priority,
      category,
      subject: input.subject,
    });
    suggestedResponse = drafted.customerMessage;
  } catch (err) {
    console.error('LLM customer reply drafting failed:', err);
    responseFailed = true;
    suggestedResponse =
      input.defaults?.suggestedResponse ??
      "Thanks for reaching out. We've received your request and our team will review it. If you can share any additional details, we'll be able to help faster.";
  }

  const triageFailed = classificationFailed || responseFailed;
  const triageError =
    classificationFailed && responseFailed
      ? 'LLM_CLASSIFICATION_AND_RESPONSE_FAILED'
      : classificationFailed
        ? 'LLM_CLASSIFICATION_FAILED'
        : responseFailed
          ? 'LLM_RESPONSE_FAILED'
          : null;

  return {
    priority,
    category,
    suggestedResponse,
    status: triageFailed ? 'failed' : 'succeeded',
    error: triageError,
  };
}
