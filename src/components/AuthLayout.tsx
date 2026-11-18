import type { ReactNode } from 'react';
import { BRAND_NAME, REGULATORY_DISCLOSURE } from '../config';
import { LogoIcon } from './Icons';

export function AuthLayout({ children }: { children: ReactNode }) {
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
        <span className="login-disclosure">{REGULATORY_DISCLOSURE}</span>
      </section>
      <main className="login-panel">{children}</main>
    </div>
  );
}

export function FormError({ id, message }: { id: string; message: string | null }) {
  if (!message) return null;
  return (
    <span id={id} className="form-error" role="alert">
      {message}
    </span>
  );
}
