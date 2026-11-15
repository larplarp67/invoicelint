/** Invoices the page can load, taken from the test fixtures so they stay in step with the rules. */
import registrationTypo from '../../test/fixtures/invalid/06-registration-number-typo.json?raw';

/**
 * The fixtures carry "$comment" and "$expect" for the test suite. The page
 * shows only the invoice, so a visitor sees what a real one would contain.
 */
export function withoutTestKeys(json: string): string {
  const data: unknown = JSON.parse(json);
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return json;
  const kept = Object.fromEntries(Object.entries(data).filter(([key]) => !key.startsWith('$')));
  return `${JSON.stringify(kept, null, 2)}\n`;
}

/** What the editor starts with. */
export const DEFAULT_EXAMPLE = {
  name: '06-registration-number-typo.json',
  text: withoutTestKeys(registrationTypo),
};
