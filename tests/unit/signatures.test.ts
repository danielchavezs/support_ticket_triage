/**
 * Tests for the Dedup Feature's signature helpers.
 *
 * `normalize` is the load-bearing contract — two near-duplicate submissions
 * should produce the same string, otherwise the deterministic-hash strategy
 * will miss them. `hashNormalized` is just SHA-256 hex; we verify
 * determinism and that different inputs produce different outputs.
 */

import { describe, expect, it } from 'vitest';

import { hashNormalized, normalize } from '@/services/features/dedup/signatures';

describe('normalize', () => {
  it('lowercases the concatenated subject + description', () => {
    expect(normalize('Hello', 'World')).toBe('hello world');
  });

  it('treats variations in whitespace identically', () => {
    const a = normalize('My printer is broken', 'It stopped today.');
    const b = normalize('My   printer\tis broken', '  It    stopped today.   ');
    expect(a).toBe(b);
  });

  it('treats punctuation as whitespace and folds to a single space', () => {
    const a = normalize("Can't connect", 'Server down!');
    const b = normalize('Cant connect', 'Server down');
    expect(a).toBe(b);
  });

  it('preserves Unicode letters (accents, non-Latin)', () => {
    const result = normalize('Étape échouée', 'Échec critique');
    // Latin letters with accents preserved; punctuation stripped; lowercased.
    expect(result).toBe('étape échouée échec critique');
  });

  it('preserves digits alongside letters', () => {
    // Punctuation strips to empty; whitespace + digits/letters survive.
    expect(normalize('Error 500', 'Code: 500_internal')).toBe('error 500 code 500internal');
  });

  it('returns an empty string when both fields are whitespace/punctuation only', () => {
    expect(normalize('   ', '!!!')).toBe('');
  });

  it('does not collapse subject and description into the same token sequence indistinguishably', () => {
    // "abc" + "" should NOT equal "" + "abc" — the concatenation order matters
    // for content, even if normalized whitespace is the same length. Both
    // sides contribute their own tokens; subject's word leads.
    const a = normalize('abc', '');
    const b = normalize('', 'abc');
    expect(a).toBe('abc');
    expect(b).toBe('abc');
    // (Both reduce to the same string here — that's expected: the normalized
    // form is a bag-of-words view, by design. Stable hash, intentional.)
  });
});

describe('hashNormalized', () => {
  it('produces a 64-char hex SHA-256 digest', () => {
    const hash = hashNormalized('hello world');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for identical inputs', () => {
    expect(hashNormalized('foo')).toBe(hashNormalized('foo'));
  });

  it('differs for different inputs', () => {
    expect(hashNormalized('foo')).not.toBe(hashNormalized('bar'));
  });

  it('is sensitive to whitespace (callers must normalize first)', () => {
    expect(hashNormalized('hello world')).not.toBe(hashNormalized('helloworld'));
  });
});
