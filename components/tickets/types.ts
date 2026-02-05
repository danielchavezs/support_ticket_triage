export type Ticket = {
  id: string;
  createdAt: string;
  customerName: string;
  email: string;
  subject: string;
  description: string;
  priority: 'Critical' | 'High' | 'Medium' | 'Low';
  category: 'Billing' | 'Technical' | 'Account' | 'General';
  suggestedResponse: string;
  triageStatus: 'succeeded' | 'failed';
  triageError: string | null;
};

export type NewTicketPayload = {
  customerName: string;
  email: string;
  subject: string;
  description: string;
};

export type ApiError = { code: string; message: string };

