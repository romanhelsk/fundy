import type { Transaction } from '../types';

export function isInflow(t: Transaction) {
  return t.type === 'Deposit' || t.type === 'Credit';
}

export function txTitle(t: Transaction) {
  switch (t.type) {
    case 'Credit':
      return 'Balance credit';
    case 'Debit':
      return 'Balance debit';
    default:
      return t.type;
  }
}

/** Second line under the title: the payment method, or the note for adjustments. */
export function txSubtitle(t: Transaction, methodLabels: Record<string, string>) {
  if (t.methodId) return methodLabels[t.methodId] ?? 'Removed account';
  return t.note ?? 'Adjustment';
}
