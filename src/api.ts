import type { DepositResponse, MfaChallenge, Overview, User } from './types';

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
  overview: () => request<Overview>('GET', '/overview'),
  deposit: (amountCents: number, methodId: string) =>
    request<DepositResponse>('POST', '/deposits', { amountCents, methodId }),
};
