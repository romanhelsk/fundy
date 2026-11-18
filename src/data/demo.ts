// Demo data — mirrors the design. Replace with the real ledger before launch
// (see "Pendientes del cliente" in the spec).

export type TxType = 'Deposit' | 'Withdrawal';
export type TxStatus = 'Completed' | 'Pending' | 'Failed';

export interface PaymentMethod {
  id: string;
  kind: 'bank' | 'card';
  label: string; // short, e.g. "Bank •••• 4417"
  longLabel: string; // e.g. "Bank transfer •••• 4417"
}

export interface Transaction {
  id: string; // reference, e.g. TX-80412
  date: string; // ISO date
  type: TxType;
  methodId: string;
  status: TxStatus;
  amountCents: number; // always positive; sign comes from type
}

export const BRAND_NAME = '[BRAND NAME]';
export const CLIENT_NAME = '[Client Name]';
export const CLIENT_INITIALS = 'AC';
export const IS_DEMO = true;
/** Fixed "today" so date filters stay stable against the demo data. */
export const DEMO_TODAY = '2026-11-18';

export const paymentMethods: PaymentMethod[] = [
  { id: 'bank-4417', kind: 'bank', label: 'Bank •••• 4417', longLabel: 'Bank transfer •••• 4417' },
  { id: 'card-0932', kind: 'card', label: 'Card •••• 0932', longLabel: 'Card •••• 0932' },
];

export const initialBalance = {
  availableCents: 124_830_957,
  pendingCents: 1_245_000,
  updatedMinutesAgo: 2,
};

export const monthSummary = {
  depositsCents: 8_420_000,
  depositsCount: 6,
  withdrawalsCents: 3_167_540,
  withdrawalsCount: 3,
  pendingCount: 2,
};

/** Total number of transactions on the account (the table only shows the latest). */
export const TOTAL_TX_COUNT = 48;

export const initialTransactions: Transaction[] = [
  { id: 'TX-80412', date: '2026-11-18', type: 'Deposit', methodId: 'bank-4417', status: 'Pending', amountCents: 1_245_000 },
  { id: 'TX-80377', date: '2026-11-15', type: 'Withdrawal', methodId: 'bank-4417', status: 'Completed', amountCents: 800_000 },
  { id: 'TX-80321', date: '2026-11-12', type: 'Deposit', methodId: 'card-0932', status: 'Failed', amountCents: 500_000 },
  { id: 'TX-80290', date: '2026-11-10', type: 'Deposit', methodId: 'bank-4417', status: 'Completed', amountCents: 2_500_000 },
  { id: 'TX-80211', date: '2026-11-06', type: 'Withdrawal', methodId: 'bank-4417', status: 'Completed', amountCents: 1_567_540 },
  { id: 'TX-80158', date: '2026-11-03', type: 'Deposit', methodId: 'card-0932', status: 'Completed', amountCents: 920_000 },
  { id: 'TX-80102', date: '2026-11-01', type: 'Withdrawal', methodId: 'bank-4417', status: 'Completed', amountCents: 800_000 },
];

export function methodById(id: string): PaymentMethod {
  return paymentMethods.find((m) => m.id === id) ?? paymentMethods[0];
}
