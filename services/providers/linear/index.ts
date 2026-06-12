'server-only';

/**
 * Linear Provider — adapter for the outbound issue push (Phase 4) and the
 * inbound webhook signature verification (Phase 5).
 *
 * The Provider stays narrow: each method maps 1:1 to an underlying SDK call
 * and never depends on Feature-layer types. Schemas live in the Feature
 * layer; this Provider exposes plain TypeScript types so Features can
 * orchestrate without importing from `@linear/sdk` directly.
 *
 * Errors propagate raw — the Feature layer normalizes them to `FeatureError`
 * per `AGENTS.md` §6. In particular, `RatelimitedLinearError` and
 * `NetworkLinearError` from `@linear/sdk` surface here unchanged; the
 * Feature decides whether to treat them as transient (retryable) or fatal.
 */

import { LinearWebhookSignatureError } from '@/services/providers/linear/errors';
import { getLinearClient, getLinearWebhookClient } from '@/services/providers/linear/client';

export type LinearCreateIssueInput = {
  teamId: string;
  title: string;
  description: string;
  /**
   * Linear's numeric priority scale:
   *   0 = No priority, 1 = Urgent, 2 = High, 3 = Medium, 4 = Low.
   * Phase 4 only emits 1..4 (the triage matrix is total over our
   * type x severity space; tickets without a priority never reach the
   * push step).
   */
  priority: 1 | 2 | 3 | 4;
};

export type LinearCreatedIssue = {
  /** Linear's canonical UUID for the issue. Persisted as `tickets.linear_issue_id`. */
  issueId: string;
  /** Human-readable identifier e.g. `AIR-123`. Recorded in the event payload. */
  identifier: string;
  /** Permalink to the issue. Recorded in the event payload. */
  url: string;
};

export type LinearIssueLookup = {
  id: string;
  identifier: string;
  url: string;
  title: string;
  /** The workflow state's display name (e.g. "In Progress"). Phase 5 uses this for status routing. */
  stateName: string;
};

/**
 * Parsed webhook payload as surfaced by `LinearWebhookClient.parseData`.
 * Returned as `unknown` from the Provider: the Feature layer validates the
 * exact shape it cares about with Zod, so the Provider stays narrow and
 * doesn't leak SDK internals.
 */
export type LinearWebhookParsedPayload = unknown;

export type LinearProvider = {
  createIssue(input: LinearCreateIssueInput): Promise<LinearCreatedIssue>;
  getIssue(issueId: string): Promise<LinearIssueLookup | null>;
  verifyWebhookSignature(input: {
    rawBody: Buffer;
    signature: string;
    timestamp?: number | string;
    /** Optional override for unit tests; production reads `LINEAR_WEBHOOK_SECRET`. */
    secret?: string;
  }): boolean;
  /**
   * Verify the signature AND parse the JSON body in one call. Throws
   * `LinearWebhookSignatureError` on signature failure; throws a plain
   * `Error` on JSON parse failure (the Feature normalizes both).
   */
  parseWebhookPayload(input: {
    rawBody: Buffer;
    signature: string;
    timestamp?: number | string;
    secret?: string;
  }): LinearWebhookParsedPayload;
};

export const linear: LinearProvider = {
  async createIssue(input) {
    const client = getLinearClient();
    const payload = await client.createIssue({
      teamId: input.teamId,
      title: input.title,
      description: input.description,
      priority: input.priority,
    });

    if (!payload.success || !payload.issueId) {
      throw new Error('Linear createIssue: payload.success was false or issueId missing.');
    }

    // Resolve the lazy `issue` accessor to surface the human identifier + URL.
    // Costs one extra round-trip; the audit value (e.g. AIR-123 in operator
    // tooling) outweighs the latency on the happy path.
    const issue = await payload.issue;
    if (!issue) {
      throw new Error('Linear createIssue: payload.issue resolved to undefined.');
    }

    return {
      issueId: payload.issueId,
      identifier: issue.identifier,
      url: issue.url,
    };
  },

  async getIssue(issueId) {
    const client = getLinearClient();
    let issue;
    try {
      issue = await client.issue(issueId);
    } catch (err) {
      // Linear's SDK throws on not-found in some flows; treat "not found"
      // shapes as null. Other errors propagate.
      const message = err instanceof Error ? err.message : String(err);
      if (/not found|entity not found|could not find/i.test(message)) {
        return null;
      }
      throw err;
    }
    if (!issue) return null;

    const state = await issue.state;
    return {
      id: issue.id,
      identifier: issue.identifier,
      url: issue.url,
      title: issue.title,
      stateName: state?.name ?? 'unknown',
    };
  },

  verifyWebhookSignature({ rawBody, signature, timestamp, secret }) {
    const client = getLinearWebhookClient(secret);
    try {
      return client.verify(rawBody, signature, timestamp);
    } catch (err) {
      // The SDK throws on bad signature/timestamp. Re-wrap so the Feature
      // layer can distinguish signature failures from network/SDK errors.
      const message = err instanceof Error ? err.message : String(err);
      throw new LinearWebhookSignatureError(message);
    }
  },

  parseWebhookPayload({ rawBody, signature, timestamp, secret }) {
    const client = getLinearWebhookClient(secret);
    try {
      // `parseData` verifies the signature and then JSON-parses the body.
      // SDK semantics: on signature failure it throws; on JSON failure it
      // also throws. We separate the two by attempting verify-only first
      // so we can wrap signature failures specifically.
      const verified = client.verify(rawBody, signature, timestamp);
      if (!verified) {
        throw new LinearWebhookSignatureError('Linear webhook signature verification returned false.');
      }
    } catch (err) {
      if (err instanceof LinearWebhookSignatureError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw new LinearWebhookSignatureError(message);
    }

    try {
      return JSON.parse(rawBody.toString('utf8')) as LinearWebhookParsedPayload;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Linear webhook payload JSON parse failed: ${message}`);
    }
  },
};
