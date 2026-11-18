export type TxType = 'Deposit' | 'Withdrawal';
export type TxStatus = 'Completed' | 'Pending' | 'Failed';

export interface User {
  id: number;
  email: string;
  name: string;
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
  methodId: string;
  status: TxStatus;
  amountCents: number; // always positive; sign comes from type
  errorCode: string | null;
}

export interface Overview {
  user: User;
  gateway: { name: string; isTest: boolean; triggers: { cents: number; outcome: string }[] };
  balance: { availableCents: number; pendingCents: number; totalCents: number; asOf: string };
  summary: {
    depositsCents: number;
    depositsCount: number;
    withdrawalsCents: number;
    withdrawalsCount: number;
    pendingCount: number;
  };
  methods: PaymentMethod[];
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
