import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';
import type { MfaChallenge } from '../types';
import { AuthLayout, FormError } from './AuthLayout';
import { LockIcon } from './Icons';

interface Props {
  notice?: string | null;
  onChallenge: (challenge: MfaChallenge) => void;
  onCreateAccount: () => void;
}

export function Login({ notice, onChallenge, onCreateAccount }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError('Enter a valid email address.');
    if (!password) return setError('Enter your password.');
    setError(null);
    setBusy(true);
    try {
      onChallenge(await api.login(email, password, remember));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <form className="login-form" onSubmit={handleSubmit} noValidate aria-describedby={error ? 'login-error' : undefined}>
        <div>
          <h2>Sign in</h2>
          <span className="muted" style={{ fontSize: 14 }}>
            Enter your account details to continue.
          </span>
        </div>

        {notice && (
          <div className="notice" role="status">
            {notice}
          </div>
        )}

        <label className="field">
          Email
          <input
            className="input"
            type="email"
            name="email"
            autoComplete="username"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>

        <div className="field">
          <div className="field-row">
            <label htmlFor="password">Password</label>
            {/* TODO: password reset flow */}
            <a href="#forgot" style={{ fontSize: 13 }}>
              Forgot password?
            </a>
          </div>
          <input
            id="password"
            className="input"
            type="password"
            name="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        <label className="checkbox">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Keep me signed in on this device
        </label>

        <FormError id="login-error" message={error} />

        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <div className="notice">
          <LockIcon size={16} />
          Two-factor verification is required after sign in.
        </div>

        <span className="muted" style={{ fontSize: 14, textAlign: 'center' }}>
          New here?{' '}
          <button type="button" className="link-btn" onClick={onCreateAccount}>
            Create an account
          </button>
        </span>
      </form>
    </AuthLayout>
  );
}
