/** Registry of built-in rule packs. */
import type { RulePack } from './types.ts';

export const BUILTIN_PACKS: readonly RulePack[] = [];

/** Look up built-in packs by ID. Throws on an unknown ID (programmer or usage error). */
export function resolvePacks(selection: readonly (string | RulePack)[]): RulePack[] {
  return selection.map((entry) => {
    if (typeof entry !== 'string') return entry;
    const pack = BUILTIN_PACKS.find((p) => p.id === entry);
    if (!pack) {
      const known = BUILTIN_PACKS.map((p) => p.id).join(', ') || '(none)';
      throw new RangeError(`Unknown rule pack "${entry}". Available packs: ${known}.`);
    }
    return pack;
  });
}
