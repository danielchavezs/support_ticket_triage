'server-only';

/**
 * Server-side Linear client factories.
 *
 * Two factories live here:
 *   - `getLinearClient()`        — main GraphQL client used by the outbound
 *                                   push (Phase 4).
 *   - `getLinearWebhookClient()` — webhook signature verifier used by the
 *                                   inbound webhook (Phase 5).
 *
 * Both read env at call time (not import time) so this module is safe to
 * import during Next.js build steps that traverse modules statically. Each
 * throws with a clear error if its required secret is missing when actually
 * invoked. The Provider stays Feature-agnostic: callers pass team IDs and
 * other parameters in via the `linear` Provider's method signatures, not via
 * imports from `services/features/`.
 */

import { LinearClient } from '@linear/sdk';
import { LinearWebhookClient } from '@linear/sdk/webhooks';

export function getLinearClient(): LinearClient {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) {
    throw new Error('Missing env var: LINEAR_API_KEY.');
  }
  return new LinearClient({ apiKey });
}

export function getLinearWebhookClient(secret?: string): LinearWebhookClient {
  const resolvedSecret = secret ?? process.env.LINEAR_WEBHOOK_SECRET;
  if (!resolvedSecret) {
    throw new Error('Missing env var: LINEAR_WEBHOOK_SECRET.');
  }
  return new LinearWebhookClient(resolvedSecret);
}

/**
 * Resolve the default Linear team ID from env. Phase 4's outbound push
 * targets this team unless the caller supplies a different team ID at the
 * Feature layer.
 */
export function getLinearTeamId(): string {
  const teamId = process.env.LINEAR_TEAM_ID;
  if (!teamId) {
    throw new Error('Missing env var: LINEAR_TEAM_ID.');
  }
  return teamId;
}
