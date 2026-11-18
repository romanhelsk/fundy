import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';
import type { MfaChallenge, User } from '../types';
import { AuthLayout, FormError } from './AuthLayout';

interface Props {
  challenge: MfaChallenge;
  onVerified: (user: User) => void;
  /** Called when the challenge can't be used any more (expired / too many attempts). */
  onRestart: (message?: string) => void;
}

export function Verify({ challenge, onVerified, onRestart }: Props) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const clean = code.replace(/\s/g, '');
    if (!/^\d{6}$/.test(clean)) return setError('Enter the 6-digit code.');
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const { user } = await api.verify(challenge.challengeId, clean);
      onVerified(user);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CHALLENGE_EXPIRED') return onRestart(err.message);
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      setBusy(false);
    }
  }

  async function resend() {
    setError(null);
    setInfo(null);
    try {
      await api.resend(challenge.challengeId);
      setInfo('We sent you a new code.');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CHALLENGE_EXPIRED') return onRestart(err.message);
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    }
  }

  return (
    <AuthLayout>
      <form className="login-form" onSubmit={handleSubmit} noValidate aria-describedby={error ? 'verify-error' : undefined}>
        <div>
          <h2>Check your email</h2>
          <span className="muted" style={{ fontSize: 14 }}>
            Enter the 6-digit code we sent to <strong>{challenge.emailHint}</strong>. It expires in 10 minutes.
          </span>
        </div>

        <label className="field">
          Verification code
          <input
            className="input num code-input"
            name="one-time-code"
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={7}
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))}
            autoFocus
          />
        </label>

        <FormError id="verify-error" message={error} />
        {info && (
          <span className="small" role="status">
            {info}
          </span>
        )}

        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Verifying…' : 'Verify and continue'}
        </button>

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
          <button type="button" className="link-btn" onClick={resend}>
            Send a new code
          </button>
          <button type="button" className="link-btn" onClick={() => onRestart()}>
            Use a different account
          </button>
        </div>
      </form>
    </AuthLayout>
  );
}
