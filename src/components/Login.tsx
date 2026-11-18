import { useState, type FormEvent } from 'react';
import { BRAND_NAME } from '../data/demo';
import { LockIcon, LogoIcon } from './Icons';

interface Props {
  onSignIn: (remember: boolean) => void;
}

export function Login({ onSignIn }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setError('Enter a valid email address.');
      return;
    }
    if (!password) {
      setError('Enter your password.');
      return;
    }
    setError(null);
    // TODO: real authentication + mandatory two-factor step.
    onSignIn(remember);
  }

  return (
    <div className="login">
      <section className="login-brand" aria-label="About">
        <div className="brand">
          <span className="brand-mark brand-mark--light">
            <LogoIcon size={20} />
          </span>
          <span>{BRAND_NAME}</span>
        </div>
        <div className="login-pitch">
          <h1>Manage your funds in one place.</h1>
          <p>Track your balance, move money in and out, and keep a full record of every transaction.</p>
        </div>
        <span className="login-disclosure">[Licensing / regulatory disclosure]</span>
      </section>

      <main className="login-panel">
        <form className="login-form" onSubmit={handleSubmit} noValidate aria-describedby={error ? 'login-error' : undefined}>
          <div>
            <h2>Sign in</h2>
            <span className="muted" style={{ fontSize: 14 }}>
              Enter your account details to continue.
            </span>
          </div>

          <label className="field">
            Email
            <input
              className="input"
              type="email"
              name="email"
              autoComplete="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>

          <div className="field">
            <div className="field-row">
              <label htmlFor="password">Password</label>
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

          {error && (
            <span id="login-error" className="field-error" role="alert">
              {error}
            </span>
          )}

          <button type="submit" className="btn btn-primary btn-block">
            Sign in
          </button>

          <div className="notice">
            <LockIcon size={16} />
            Two-factor verification is required after sign in.
          </div>

          <span className="muted" style={{ fontSize: 14, textAlign: 'center' }}>
            New here? <a href="#signup">Create an account</a>
          </span>
        </form>
      </main>
    </div>
  );
}
