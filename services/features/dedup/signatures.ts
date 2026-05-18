/**
 * Deterministic signature helpers for the Dedup Feature.
 *
 * `normalize` collapses subject + description to a stable, comparable form:
 *   1. Concatenate `subject` + newline + `description`.
 *   2. Lowercase the whole thing.
 *   3. Strip every character that isn't a letter, digit, or whitespace — and
 *      replace it with NOTHING (not a space). The empty-replacement choice
 *      means `"can't"` and `"cant"` normalize to the same token, and
 *      `"Hello, world"` still ends up as `"hello world"` because the comma
 *      sits next to existing whitespace. The edge case it sacrifices is the
 *      rare `"hello,world"` → `"helloworld"` collapse; in practice customer
 *      tickets do not abuse punctuation that way often enough to matter.
 *   4. Collapse runs of whitespace into a single space.
 *   5. Trim leading/trailing whitespace.
 *
 * Unicode-aware: we use `\p{L}\p{N}` so accented characters survive
 * lowercasing and aren't accidentally stripped as "punctuation."
 *
 * `hashNormalized` returns the SHA-256 hex digest of the normalized text.
 * Hex is used (rather than base64) because the column is `text` and we want
 * stable URL-safe-ish identifiers for log inspection.
 */

import { createHash } from 'node:crypto';

export function normalize(subject: string, description: string): string {
  const combined = `${subject}\n${description}`;
  return combined
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function hashNormalized(normalized: string): string {
  return createHash('sha256').update(normalized).digest('hex');
}
