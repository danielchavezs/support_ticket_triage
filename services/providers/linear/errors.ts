'server-only';

/**
 * Provider-side error classes that callers in the Feature layer can match
 * on without importing from `@linear/sdk`. Per `AGENTS.md` §6, Providers
 * throw and Features interpret; these named errors give Features a stable
 * surface to switch on without sniffing string contents of generic Errors.
 */

export class LinearWebhookSignatureError extends Error {
  readonly code = 'LINEAR_WEBHOOK_SIGNATURE_INVALID';
  constructor(message: string) {
    super(message);
    this.name = 'LinearWebhookSignatureError';
  }
}
