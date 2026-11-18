import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';
import type { MfaChallenge } from '../types';
import { AuthLayout, FormError } from './AuthLayout';

interface Props {
  onChallenge: (challenge: MfaChallenge) => void;
  onSignIn: () => void;
}

const MIN_PASSWORD = 10;

export function Signup({ onChallenge, onSignIn }: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('Enter your full name.');
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError('Enter a valid email address.');
    if (password.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters for your password.`);
    setError(null);
    setBusy(true);
    try {
      onChallenge(await api.register(name.trim(), email, password));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <form className="login-form" onSubmit={handleSubmit} noValidate aria-describedby={error ? 'signup-error' : undefined}>
        <div>
          <h2>Create an account</h2>
          <span className="muted" style={{ fontSize: 14 }}>
            We'll send a code to confirm your email.
          </span>
        </div>

        <label className="field">
          Full name
          <input className="input" name="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </label>

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
          />
        </label>

        <label className="field">
          Password
          <input
            className="input"
            type="password"
            name="new-password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby="password-hint"
          />
          <span id="password-hint" className="small" style={{ fontWeight: 400 }}>
            At least {MIN_PASSWORD} characters.
          </span>
        </label>

        <FormError id="signup-error" message={error} />

        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Creating account…' : 'Create account'}
        </button>

        <span className="muted" style={{ fontSize: 14, textAlign: 'center' }}>
          Already have an account?{' '}
          <button type="button" className="link-btn" onClick={onSignIn}>
            Sign in
          </button>
        </span>
      </form>
    </AuthLayout>
  );
}
