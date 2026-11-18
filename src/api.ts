import type {
  AccountStatus,
  Balance,
  ClientDetail,
  ClientListItem,
  DepositResponse,
  MfaChallenge,
  Overview,
  PaymentMethod,
  Transaction,
  User,
} from './types';

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', "Can't reach the server. Check your connection and try again.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = data?.error;
    throw new ApiError(res.status, err?.code ?? 'UNKNOWN', err?.message ?? 'Something went wrong. Please try again.');
  }
  return data as T;
}

export const api = {
  session: () => request<{ user: User }>('GET', '/auth/session'),
  login: (email: string, password: string, remember: boolean) =>
    request<MfaChallenge>('POST', '/auth/login', { email, password, remember }),
  register: (name: string, email: string, password: string) =>
    request<MfaChallenge>('POST', '/auth/register', { name, email, password }),
  verify: (challengeId: string, code: string) => request<{ user: User }>('POST', '/auth/verify', { challengeId, code }),
  resend: (challengeId: string) => request<{ ok: true }>('POST', '/auth/resend', { challengeId }),
  logout: () => request<{ ok: true }>('POST', '/auth/logout'),
  changePassword: (newPassword: string, currentPassword?: string) =>
    request<{ user: User }>('POST', '/auth/change-password', { newPassword, currentPassword }),
  overview: () => request<Overview>('GET', '/overview'),
  deposit: (amountCents: number, methodId: string) =>
    request<DepositResponse>('POST', '/deposits', { amountCents, methodId }),

  admin: {
    clients: (q = '') => request<{ users: ClientListItem[] }>('GET', `/admin/users?q=${encodeURIComponent(q)}`),
    createClient: (name: string, email: string) =>
      request<{ user: User; temporaryPassword: string }>('POST', '/admin/users', { name, email }),
    client: (id: number) => request<ClientDetail>('GET', `/admin/users/${id}`),
    reactivate: (id: number) => request<{ account: AccountStatus }>('POST', `/admin/users/${id}/reactivate`),
    resetPassword: (id: number) =>
      request<{ user: User; temporaryPassword: string }>('POST', `/admin/users/${id}/reset-password`),
    adjust: (id: number, body: { direction: 'credit' | 'debit'; amountCents: number; status: 'Completed' | 'Pending'; note: string }) =>
      request<{ transaction: Transaction; balance: Balance }>('POST', `/admin/users/${id}/adjustments`, body),
    settle: (id: number, ref: string, status: 'Completed' | 'Failed') =>
      request<{ transaction: Transaction; balance: Balance }>(
        'POST',
        `/admin/users/${id}/transactions/${encodeURIComponent(ref)}/settle`,
        { status },
      ),
    linkMethod: (id: number, body: { kind: 'bank' | 'card'; last4: string; institution: string }) =>
      request<{ methods: PaymentMethod[] }>('POST', `/admin/users/${id}/methods`, body),
    removeMethod: (id: number, methodId: string) =>
      request<{ methods: PaymentMethod[] }>('POST', `/admin/users/${id}/methods/${encodeURIComponent(methodId)}/remove`),
  },
};
