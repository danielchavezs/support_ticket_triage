export function isValidEmail(value: string): boolean {
  if (value.length > 320) return false;
  // Minimal sanity check (avoid over-rejecting valid emails).
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

