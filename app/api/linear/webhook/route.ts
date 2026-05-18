import { NextResponse } from 'next/server';

import { handleWebhookFeature } from '@/services/features/linear-sync/handleWebhook';

export const runtime = 'nodejs';

/**
 * Linear inbound webhook (Phase 5).
 *
 * Transport responsibilities only:
 *   1. Read the raw bytes (signature verification requires byte-exact
 *      input — we never `.json()` the body upstream).
 *   2. Read `linear-signature` and `linear-timestamp` headers.
 *   3. Delegate to `handleWebhookFeature`.
 *   4. Map outcomes to HTTP:
 *        - signature failures           → 401
 *        - parse failures               → 400
 *        - other feature failures       → 500 (Linear retries)
 *        - any success (applied /
 *          duplicate / ignored /
 *          unknown_ticket)              → 200
 *
 * Linear retries on non-2xx. The "200 on unknown_ticket" policy is
 * deliberate: a 404-style response would create a retry storm for any
 * issue not owned by us (e.g., created directly in Linear). The Feature
 * logs unknown issue IDs for operator visibility.
 */
export async function POST(request: Request): Promise<Response> {
  let rawBody: Buffer;
  try {
    rawBody = Buffer.from(await request.arrayBuffer());
  } catch (err) {
    console.error('Linear webhook: failed to read raw body:', err);
    return NextResponse.json(
      { error: { code: 'INVALID_REQUEST', message: 'Could not read request body.' } },
      { status: 400 },
    );
  }

  const signatureHeader = request.headers.get('linear-signature');
  const timestampHeader = request.headers.get('linear-timestamp');

  const result = await handleWebhookFeature({
    rawBody,
    signatureHeader,
    timestampHeader,
  });

  if (!result.success) {
    const statusCode =
      result.error.code === 'LINEAR_WEBHOOK_SIGNATURE_INVALID'
        ? 401
        : result.error.code === 'LINEAR_WEBHOOK_PARSE_FAILED'
          ? 400
          : 500;
    return NextResponse.json({ error: result.error }, { status: statusCode });
  }

  return NextResponse.json({ outcome: result.data }, { status: 200 });
}
