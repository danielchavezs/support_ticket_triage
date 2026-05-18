/**
 * Linear Provider tests.
 *
 * Asserts:
 *   - `createIssue` forwards teamId / title / description / priority verbatim
 *     to the SDK, awaits the lazy `issue` accessor to surface identifier +
 *     url, and returns the unwrapped `{ issueId, identifier, url }` shape.
 *   - SDK rejections propagate raw so the Feature layer can normalize them
 *     to `LINEAR_PUSH_FAILED`.
 *   - `getIssue` returns `null` for not-found responses and unwraps the
 *     lazy `state` accessor.
 *   - `verifyWebhookSignature` returns the SDK boolean on a valid signature
 *     and rewraps SDK throws as `LinearWebhookSignatureError`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { linear } from '@/services/providers/linear';
import { LinearWebhookSignatureError } from '@/services/providers/linear/errors';

// Hoisted mocks so the Provider's imports see them.
const createIssueMock = vi.fn();
const issueMock = vi.fn();
const verifyMock = vi.fn();

vi.mock('@linear/sdk', () => ({
  LinearClient: class {
    createIssue = createIssueMock;
    issue = issueMock;
  },
}));

vi.mock('@linear/sdk/webhooks', () => ({
  LinearWebhookClient: class {
    verify = verifyMock;
  },
}));

const ENV_BACKUP = {
  LINEAR_API_KEY: process.env.LINEAR_API_KEY,
  LINEAR_WEBHOOK_SECRET: process.env.LINEAR_WEBHOOK_SECRET,
  LINEAR_TEAM_ID: process.env.LINEAR_TEAM_ID,
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LINEAR_API_KEY = 'lin_api_test';
  process.env.LINEAR_WEBHOOK_SECRET = 'whsec_test';
  process.env.LINEAR_TEAM_ID = 'team-uuid';
});

afterEach(() => {
  process.env.LINEAR_API_KEY = ENV_BACKUP.LINEAR_API_KEY;
  process.env.LINEAR_WEBHOOK_SECRET = ENV_BACKUP.LINEAR_WEBHOOK_SECRET;
  process.env.LINEAR_TEAM_ID = ENV_BACKUP.LINEAR_TEAM_ID;
});

describe('linear.createIssue', () => {
  it('forwards input to the SDK and returns the unwrapped issue', async () => {
    const fakeIssue = { id: 'lin-uuid-1', identifier: 'AIR-42', url: 'https://linear.app/airiamspace/issue/AIR-42' };
    createIssueMock.mockResolvedValue({
      success: true,
      issueId: 'lin-uuid-1',
      issue: Promise.resolve(fakeIssue),
    });

    const result = await linear.createIssue({
      teamId: 'team-uuid',
      title: 'SSO broken',
      description: 'Redirect loop after login.',
      priority: 2,
    });

    expect(createIssueMock).toHaveBeenCalledWith({
      teamId: 'team-uuid',
      title: 'SSO broken',
      description: 'Redirect loop after login.',
      priority: 2,
    });
    expect(result).toEqual({
      issueId: 'lin-uuid-1',
      identifier: 'AIR-42',
      url: 'https://linear.app/airiamspace/issue/AIR-42',
    });
  });

  it('throws when the SDK reports success=false', async () => {
    createIssueMock.mockResolvedValue({ success: false, issueId: undefined, issue: Promise.resolve(null) });

    await expect(
      linear.createIssue({ teamId: 't', title: 'x', description: 'y', priority: 1 }),
    ).rejects.toThrow(/success was false|issueId missing/);
  });

  it('throws when the lazy issue accessor resolves to undefined', async () => {
    createIssueMock.mockResolvedValue({ success: true, issueId: 'lin-1', issue: Promise.resolve(undefined) });

    await expect(
      linear.createIssue({ teamId: 't', title: 'x', description: 'y', priority: 1 }),
    ).rejects.toThrow(/payload\.issue resolved to undefined/);
  });

  it('propagates SDK rejections raw (Feature layer normalizes)', async () => {
    createIssueMock.mockRejectedValue(new Error('rate limited'));

    await expect(
      linear.createIssue({ teamId: 't', title: 'x', description: 'y', priority: 1 }),
    ).rejects.toThrow('rate limited');
  });

  it('throws a clear error when LINEAR_API_KEY is missing', async () => {
    delete process.env.LINEAR_API_KEY;

    await expect(
      linear.createIssue({ teamId: 't', title: 'x', description: 'y', priority: 1 }),
    ).rejects.toThrow(/LINEAR_API_KEY/);
  });
});

describe('linear.getIssue', () => {
  it('returns the unwrapped lookup shape', async () => {
    issueMock.mockResolvedValue({
      id: 'lin-1',
      identifier: 'AIR-7',
      url: 'https://linear.app/.../AIR-7',
      title: 'Old ticket',
      state: Promise.resolve({ name: 'In Progress' }),
    });

    const result = await linear.getIssue('lin-1');
    expect(issueMock).toHaveBeenCalledWith('lin-1');
    expect(result).toEqual({
      id: 'lin-1',
      identifier: 'AIR-7',
      url: 'https://linear.app/.../AIR-7',
      title: 'Old ticket',
      stateName: 'In Progress',
    });
  });

  it('returns null for not-found errors', async () => {
    issueMock.mockRejectedValue(new Error('Entity not found: issue lin-9'));

    const result = await linear.getIssue('lin-9');
    expect(result).toBeNull();
  });

  it('propagates non-not-found errors raw', async () => {
    issueMock.mockRejectedValue(new Error('rate limited'));

    await expect(linear.getIssue('lin-9')).rejects.toThrow('rate limited');
  });

  it('defaults stateName to "unknown" when state resolves to null', async () => {
    issueMock.mockResolvedValue({
      id: 'lin-1',
      identifier: 'AIR-1',
      url: 'u',
      title: 't',
      state: Promise.resolve(null),
    });

    const result = await linear.getIssue('lin-1');
    expect(result?.stateName).toBe('unknown');
  });
});

describe('linear.verifyWebhookSignature', () => {
  it('returns the SDK boolean on a valid signature', () => {
    verifyMock.mockReturnValue(true);

    const ok = linear.verifyWebhookSignature({
      rawBody: Buffer.from('{}'),
      signature: 'sha256=abc',
      timestamp: '2026-05-16T00:00:00Z',
    });

    expect(verifyMock).toHaveBeenCalledWith(
      Buffer.from('{}'),
      'sha256=abc',
      '2026-05-16T00:00:00Z',
    );
    expect(ok).toBe(true);
  });

  it('wraps SDK throws as LinearWebhookSignatureError', () => {
    verifyMock.mockImplementation(() => {
      throw new Error('Invalid signature');
    });

    expect(() =>
      linear.verifyWebhookSignature({
        rawBody: Buffer.from('{}'),
        signature: 'sha256=bad',
      }),
    ).toThrow(LinearWebhookSignatureError);
  });

  it('throws when LINEAR_WEBHOOK_SECRET is missing and no secret override is provided', () => {
    delete process.env.LINEAR_WEBHOOK_SECRET;

    expect(() =>
      linear.verifyWebhookSignature({ rawBody: Buffer.from('{}'), signature: 'x' }),
    ).toThrow(/LINEAR_WEBHOOK_SECRET/);
  });

  it('honors the secret override (used by tests / per-route secrets)', () => {
    delete process.env.LINEAR_WEBHOOK_SECRET;
    verifyMock.mockReturnValue(true);

    const ok = linear.verifyWebhookSignature({
      rawBody: Buffer.from('{}'),
      signature: 'sha256=ok',
      secret: 'whsec_override',
    });

    expect(ok).toBe(true);
  });
});

describe('linear.parseWebhookPayload', () => {
  it('verifies signature then JSON-parses the body', () => {
    verifyMock.mockReturnValue(true);
    const body = Buffer.from(JSON.stringify({ type: 'Issue', action: 'update' }));

    const parsed = linear.parseWebhookPayload({
      rawBody: body,
      signature: 'sha256=ok',
      timestamp: '2026-05-18T00:00:00Z',
    });

    expect(verifyMock).toHaveBeenCalledWith(body, 'sha256=ok', '2026-05-18T00:00:00Z');
    expect(parsed).toEqual({ type: 'Issue', action: 'update' });
  });

  it('throws LinearWebhookSignatureError when verify returns false', () => {
    verifyMock.mockReturnValue(false);

    expect(() =>
      linear.parseWebhookPayload({
        rawBody: Buffer.from('{}'),
        signature: 'sha256=bad',
      }),
    ).toThrow(LinearWebhookSignatureError);
  });

  it('throws LinearWebhookSignatureError when the SDK verify throws', () => {
    verifyMock.mockImplementation(() => {
      throw new Error('invalid timestamp');
    });

    expect(() =>
      linear.parseWebhookPayload({
        rawBody: Buffer.from('{}'),
        signature: 'sha256=ok',
      }),
    ).toThrow(LinearWebhookSignatureError);
  });

  it('throws a plain Error on malformed JSON', () => {
    verifyMock.mockReturnValue(true);

    expect(() =>
      linear.parseWebhookPayload({
        rawBody: Buffer.from('not-json{'),
        signature: 'sha256=ok',
      }),
    ).toThrow(/JSON parse failed/);
  });
});
