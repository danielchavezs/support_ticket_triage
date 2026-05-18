/**
 * Tests for POST /api/linear/webhook (Phase 5).
 *
 * Asserts the transport-layer mapping from FeatureResult codes to HTTP:
 *   - LINEAR_WEBHOOK_SIGNATURE_INVALID → 401
 *   - LINEAR_WEBHOOK_PARSE_FAILED      → 400
 *   - any other feature failure        → 500
 *   - any success outcome (applied /
 *     duplicate / ignored /
 *     unknown_ticket)                  → 200
 *
 * Also asserts the route forwards the raw bytes (not parsed JSON) and
 * the two signed-webhook headers verbatim.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockedFunction } from 'vitest';

import { POST } from '@/app/api/linear/webhook/route';
import { handleWebhookFeature } from '@/services/features/linear-sync/handleWebhook';

vi.mock('@/services/features/linear-sync/handleWebhook', () => ({
  handleWebhookFeature: vi.fn(),
}));

vi.mock('next/server', () => ({
  NextResponse: {
    json: vi.fn((data, init) => ({
      json: async () => data,
      status: init?.status ?? 200,
    })),
  },
}));

const handleMock = handleWebhookFeature as unknown as MockedFunction<typeof handleWebhookFeature>;

function makeRequest({
  body = '{"type":"Issue","action":"update"}',
  signature = 'sha256=ok',
  timestamp = '1700000000000',
  bodyReader = 'arrayBuffer' as 'arrayBuffer' | 'reject',
}: {
  body?: string;
  signature?: string | null;
  timestamp?: string | null;
  bodyReader?: 'arrayBuffer' | 'reject';
} = {}): Request {
  const headers = new Map<string, string>();
  if (signature !== null) headers.set('linear-signature', signature);
  if (timestamp !== null) headers.set('linear-timestamp', timestamp);

  return {
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
    arrayBuffer:
      bodyReader === 'reject'
        ? () => Promise.reject(new Error('stream failed'))
        : async () => new TextEncoder().encode(body).buffer,
  } as unknown as Request;
}

describe('POST /api/linear/webhook', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy?.mockRestore();
    consoleErrorSpy = null;
  });

  it('returns 200 on applied outcome and forwards rawBody + headers to the Feature', async () => {
    handleMock.mockResolvedValue({
      success: true,
      data: {
        kind: 'applied',
        ticket: {} as never,
        transition: {} as never,
      },
    });

    const response = await POST(makeRequest());
    const json = (await response.json()) as { outcome: { kind: string } };

    expect(handleMock).toHaveBeenCalledTimes(1);
    const arg = handleMock.mock.calls[0][0];
    expect(Buffer.isBuffer(arg.rawBody)).toBe(true);
    expect(arg.rawBody.toString('utf8')).toBe('{"type":"Issue","action":"update"}');
    expect(arg.signatureHeader).toBe('sha256=ok');
    expect(arg.timestampHeader).toBe('1700000000000');
    expect(response.status).toBe(200);
    expect(json.outcome.kind).toBe('applied');
  });

  it('returns 200 on duplicate outcome', async () => {
    handleMock.mockResolvedValue({ success: true, data: { kind: 'duplicate' } });

    const response = await POST(makeRequest());
    expect(response.status).toBe(200);
    const json = (await response.json()) as { outcome: { kind: string } };
    expect(json.outcome.kind).toBe('duplicate');
  });

  it('returns 200 on ignored outcome', async () => {
    handleMock.mockResolvedValue({ success: true, data: { kind: 'ignored', reason: 'not-issue' } });

    const response = await POST(makeRequest());
    expect(response.status).toBe(200);
  });

  it('returns 200 on unknown_ticket outcome', async () => {
    handleMock.mockResolvedValue({ success: true, data: { kind: 'unknown_ticket', linearIssueId: 'lin-x' } });

    const response = await POST(makeRequest());
    expect(response.status).toBe(200);
  });

  it('returns 401 on LINEAR_WEBHOOK_SIGNATURE_INVALID', async () => {
    handleMock.mockResolvedValue({
      success: false,
      error: { code: 'LINEAR_WEBHOOK_SIGNATURE_INVALID', message: 'bad sig' },
    });

    const response = await POST(makeRequest());
    expect(response.status).toBe(401);
    const json = (await response.json()) as { error: { code: string } };
    expect(json.error.code).toBe('LINEAR_WEBHOOK_SIGNATURE_INVALID');
  });

  it('returns 400 on LINEAR_WEBHOOK_PARSE_FAILED', async () => {
    handleMock.mockResolvedValue({
      success: false,
      error: { code: 'LINEAR_WEBHOOK_PARSE_FAILED', message: 'bad json' },
    });

    const response = await POST(makeRequest());
    expect(response.status).toBe(400);
  });

  it('returns 500 on any other feature failure', async () => {
    handleMock.mockResolvedValue({
      success: false,
      error: { code: 'TICKET_UPDATE_FAILED', message: 'db down' },
    });

    const response = await POST(makeRequest());
    expect(response.status).toBe(500);
  });

  it('returns 400 when the raw body cannot be read', async () => {
    const response = await POST(makeRequest({ bodyReader: 'reject' }));
    expect(response.status).toBe(400);
    expect(handleMock).not.toHaveBeenCalled();
  });

  it('forwards a missing signature header as null', async () => {
    handleMock.mockResolvedValue({
      success: false,
      error: { code: 'LINEAR_WEBHOOK_SIGNATURE_INVALID', message: 'missing' },
    });

    await POST(makeRequest({ signature: null }));
    expect(handleMock.mock.calls[0][0].signatureHeader).toBeNull();
  });

  it('forwards a missing timestamp header as null', async () => {
    handleMock.mockResolvedValue({ success: true, data: { kind: 'duplicate' } });

    await POST(makeRequest({ timestamp: null }));
    expect(handleMock.mock.calls[0][0].timestampHeader).toBeNull();
  });
});
