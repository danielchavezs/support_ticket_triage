import { describe, expect, test } from 'vitest';

import { isValidEmail } from '@/services/features/tickets/validation';

describe('isValidEmail', () => {
  test('accepts common valid emails', () => {
    expect(isValidEmail('jane@example.com')).toBe(true);
    expect(isValidEmail('john.doe+tag@sub.example.co')).toBe(true);
  });

  test('rejects invalid emails', () => {
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail('no-at-symbol')).toBe(false);
    expect(isValidEmail('a@b')).toBe(false);
    expect(isValidEmail('a@b.')).toBe(false);
    expect(isValidEmail('a@.com')).toBe(false);
    expect(isValidEmail(' space@example.com')).toBe(false);
  });

  test('rejects overly long emails', () => {
    const local = 'a'.repeat(321);
    expect(isValidEmail(`${local}@example.com`)).toBe(false);
  });
});

