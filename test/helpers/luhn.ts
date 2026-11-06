/**
 * Test-only Luhn helpers, written independently of src/ so the tests don't
 * validate the implementation against itself.
 */

/** Compute the Luhn check digit for a payload (digits only). */
export function luhnCheckDigit(payload: string): string {
  // Double every second digit counting from the right of the payload
  // (the check digit will be appended to its right).
  const digits = payload.split('').reverse().map(Number);
  const sum = digits.reduce((acc, d, i) => {
    if (i % 2 === 0) {
      const doubled = d * 2;
      return acc + Math.floor(doubled / 10) + (doubled % 10);
    }
    return acc + d;
  }, 0);
  return String((10 - (sum % 10)) % 10);
}

/** Make a Luhn-valid 9-digit BN from an 8-digit payload. */
export function makeBn(payload8: string): string {
  if (!/^\d{8}$/.test(payload8)) throw new Error('payload must be 8 digits');
  return payload8 + luhnCheckDigit(payload8);
}
