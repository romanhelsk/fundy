/** Credit / Debit are balance adjustments made by an admin. */
export type TxType = 'Deposit' | 'Withdrawal' | 'Credit' | 'Debit';
export type TxStatus = 'Completed' | 'Pending' | 'Failed';

export interface User {
  id: number;
  email: string;
  name: string;
  role: 'client' | 'admin';
  /** Still on an admin-issued temporary password; must set a new one before anything else. */
  mustChangePassword: boolean;
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
  /** Pending withdrawals: out of the available balance until completed or failed. */
  heldCents: number;
  totalCents: number;
}

export interface Summary {
  depositsCents: number;
  depositsCount: number;
  withdrawalsCents: number;
  withdrawalsCount: number;
  pendingCount: number;
}

export interface PendingTransfer {
  reference: string;
  type: TxType;
  /** in: the client must send the money. out: a withdrawal an admin must send. */
  direction: 'in' | 'out';
  methodLabel: string | null;
  amountCents: number;
  /** ISO time. If the transfer isn't received by then, the account is suspended. */
  dueAt: string;
}

export interface AccountStatus {
  status: 'active' | 'suspended';
  suspendedAt: string | null;
  suspendedReason: 'TRANSFER_NOT_RECEIVED' | 'WITHDRAWAL_NOT_COMPLETED' | null;
  expiredReference: string | null;
}

export interface Overview {
  user: User;
  account: AccountStatus;
  /** While set, adding and withdrawing funds are blocked. */
  pendingTransfer: PendingTransfer | null;
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
  account: AccountStatus;
  pendingTransfer: PendingTransfer | null;
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
  account: AccountStatus;
  pendingTransfer: PendingTransfer | null;
  summary: Summary;
  totalCount: number;
  methods: PaymentMethod[];
  methodLabels: Record<string, string>;
  transactions: Transaction[];
  audit: AuditEntry[];
}
