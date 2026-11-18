/** Credit / Debit are balance adjustments made by an admin. */
export type TxType = 'Deposit' | 'Withdrawal' | 'Credit' | 'Debit';
export type TxStatus = 'Completed' | 'Pending' | 'Failed';

export interface User {
  id: number;
  email: string;
  name: string;
  role: 'client' | 'admin';
}

export interface PaymentMethod {
  id: string;
  kind: 'bank' | 'card';
  label: string; // "Bank •••• 4417"
  longLabel: string; // "Bank transfer •••• 4417"
}

export interface Transaction {
  id: string; // reference, e.g. TX-80412
  date: string; // YYYY-MM-DD
  type: TxType;
  methodId: string | null; // null for admin adjustments
  status: TxStatus;
  amountCents: number; // always positive; sign comes from type
  errorCode: string | null;
  note: string | null;
}

export interface Balance {
  availableCents: number;
  pendingCents: number;
  totalCents: number;
}

export interface Summary {
  depositsCents: number;
  depositsCount: number;
  withdrawalsCents: number;
  withdrawalsCount: number;
  pendingCount: number;
}

export interface Overview {
  user: User;
  gateway: { name: string; isTest: boolean; triggers: { cents: number; outcome: string }[] };
  balance: Balance & { asOf: string };
  summary: Summary;
  methods: PaymentMethod[];
  /** Labels for every method ever linked, including removed ones. */
  methodLabels: Record<string, string>;
  transactions: Transaction[];
  totalCount: number;
}

export interface MfaChallenge {
  challengeId: string;
  emailHint: string;
}

export type DepositResponse =
  | { ok: true; transaction: Transaction; feeCents: number }
  | { ok: false; transaction: Transaction; errorCode: string; errorMessage: string };

// ---------- Admin ----------
export interface ClientListItem extends User {
  createdAt: string;
  balance: Balance;
  methodCount: number;
}

export interface AuditEntry {
  id: number;
  action: string;
  details: Record<string, unknown>;
  createdAt: string;
  adminName: string;
}

export interface ClientDetail {
  user: User & { createdAt: string };
  balance: Balance;
  summary: Summary;
  totalCount: number;
  methods: PaymentMethod[];
  methodLabels: Record<string, string>;
  transactions: Transaction[];
  audit: AuditEntry[];
}
