import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';
import type { User } from '../types';
import { AuthLayout, FormError } from './AuthLayout';
import { LockIcon } from './Icons';

interface Props {
  user: User;
  onDone: (user: User) => void;
  onSignOut: () => void;
  onSessionExpired: () => void;
}

const MIN_PASSWORD = 10;

/** First sign-in with an admin-issued temporary password: the user must choose their own. */
export function SetPassword({ user, onDone, onSignOut, onSessionExpired }: Props) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters for your password.`);
    if (password !== confirm) return setError("The passwords don't match.");
    setError(null);
    setBusy(true);
    try {
      const { user: updated } = await api.changePassword(password);
      onDone(updated);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return onSessionExpired();
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <form className="login-form" onSubmit={handleSubmit} noValidate aria-describedby={error ? 'setpw-error' : undefined}>
        <div>
          <h2>Set a new password</h2>
          <span className="muted" style={{ fontSize: 14 }}>
            Welcome, {user.name}. Your account was created with a temporary password. Choose your own to continue.
          </span>
        </div>

        {/* Lets password managers attach the new password to the right account. */}
        <input type="email" name="username" autoComplete="username" value={user.email} readOnly hidden />

        <label className="field">
          New password
          <input
            className="input"
            type="password"
            name="new-password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby="setpw-hint"
            autoFocus
          />
          <span id="setpw-hint" className="small" style={{ fontWeight: 400 }}>
            At least {MIN_PASSWORD} characters. Don't reuse the temporary password.
          </span>
        </label>

        <label className="field">
          Confirm new password
          <input
            className="input"
            type="password"
            name="confirm-password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>

        <FormError id="setpw-error" message={error} />

        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Saving…' : 'Save and continue'}
        </button>

        <div className="notice">
          <LockIcon size={16} />
          Saving signs you out on any other device.
        </div>

        <span className="muted" style={{ fontSize: 14, textAlign: 'center' }}>
          Not you?{' '}
          <button type="button" className="link-btn" onClick={onSignOut}>
            Sign out
          </button>
        </span>
      </form>
    </AuthLayout>
  );
}
