/**
 * ca-gst-hst: Canadian GST/HST input tax credit information and tax math.
 */
import type { RulePack } from '../types.ts';
import { type CaContext, createCaContext } from './context.ts';
import { bnRules } from './rules/bn.ts';
import { itcRules } from './rules/itc.ts';
import { mathRules } from './rules/math.ts';
import { currencyNotCad, thresholdsChanged, tierDetected } from './rules/tier.ts';

export const caGstHstPack: RulePack<CaContext> = {
  id: 'ca-gst-hst',
  version: '0.1.0',
  title: 'Canada GST/HST: input tax credit information (SOR/91-45 s.3) and tax math',
  // The only pack so far, so it runs on everything. Once other packs exist this
  // should look at currency, supplier province and registration number.
  appliesTo: () => true,
  createContext: createCaContext,
  rules: [tierDetected, thresholdsChanged, currencyNotCad, ...itcRules, ...bnRules, ...mathRules],
};

export type { CaContext } from './context.ts';
