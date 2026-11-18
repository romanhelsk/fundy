import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { api, ApiError } from '../api';
import { formatUSD, parseAmountToCents } from '../lib/format';
import type { Overview, PaymentMethod } from '../types';
import { AlertIcon, CheckIcon, CloseIcon, SpinnerIcon } from './Icons';

interface Props {
  methods: PaymentMethod[];
  gateway: Overview['gateway'];
  onClose: () => void;
  /** Called after the deposit settles (either way) so the dashboard can refresh. */
  onSettled: () => void;
  onContactSupport: (reference: string | null) => void;
  onSessionExpired: () => void;
}

type Step =
  | { name: 'form' }
  | { name: 'processing'; amountCents: number; method: PaymentMethod }
  | { name: 'success'; amountCents: number; reference: string; feeCents: number }
  | { name: 'error'; message: string; code: string; reference: string | null };

export function AddFundsModal({ methods, gateway, onClose, onSettled, onContactSupport, onSessionExpired }: Props) {
  const [step, setStep] = useState<Step>({ name: 'form' });
  const [amount, setAmount] = useState('');
  const [methodId, setMethodId] = useState(methods[0]?.id ?? '');
  const [formError, setFormError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Move focus into the dialog whenever the step changes.
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    (el.querySelector<HTMLElement>('[data-autofocus]') ?? el).focus();
  }, [step.name]);

  // Escape closes, except while a deposit is processing.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && step.name !== 'processing') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [step.name, onClose]);

  // Indicative progress bar while waiting on the provider.
  useEffect(() => {
    if (step.name !== 'processing') return;
    setProgress(10);
    const tick = window.setInterval(() => setProgress((p) => Math.min(p + 12, 90)), 300);
    return () => window.clearInterval(tick);
  }, [step.name]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const cents = parseAmountToCents(amount);
    if (cents === null) return setFormError('Enter an amount greater than $0.00.');
    const method = methods.find((m) => m.id === methodId);
    if (!method) return setFormError('Choose where the money comes from.');
    setFormError(null);
    setStep({ name: 'processing', amountCents: cents, method });

    try {
      const res = await api.deposit(cents, method.id);
      setProgress(100);
      if (res.ok) {
        setStep({ name: 'success', amountCents: cents, reference: res.transaction.id, feeCents: res.feeCents });
      } else {
        setStep({ name: 'error', message: res.errorMessage, code: res.errorCode, reference: res.transaction.id });
      }
      onSettled();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return onSessionExpired();
      if (err instanceof ApiError && err.status === 400) {
        // Validation problem: back to the form with the server's message.
        setFormError(err.message);
        return setStep({ name: 'form' });
      }
      setStep({
        name: 'error',
        message: err instanceof ApiError ? err.message : "We couldn't confirm this deposit.",
        code: err instanceof ApiError ? err.code : 'UNKNOWN',
        reference: null,
      });
      onSettled();
    }
  }

  // Keep Tab inside the dialog.
  function trapTab(e: ReactKeyboardEvent) {
    if (e.key !== 'Tab' || !dialogRef.current) return;
    const items = dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input, select, a[href]');
    if (items.length === 0) return e.preventDefault();
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  const isError = step.name === 'error';

  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && step.name !== 'processing') onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={`modal${step.name === 'form' ? ' modal--form' : ''}`}
        role={isError ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby="add-funds-title"
        aria-describedby="add-funds-desc"
        tabIndex={-1}
        onKeyDown={trapTab}
      >
        {step.name === 'form' && (
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }} noValidate>
            <div className="modal-head">
              <h2 id="add-funds-title">Add funds</h2>
              <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
                <CloseIcon />
              </button>
            </div>
            <p id="add-funds-desc">Deposit USD into your available balance.</p>
            <label className="field">
              Amount (USD)
              <input
                data-autofocus
                className="input num"
                inputMode="decimal"
                placeholder="25,000.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-invalid={formError ? true : undefined}
                aria-describedby={formError ? 'amount-error' : undefined}
              />
            </label>
            {formError && (
              <span id="amount-error" className="field-error" role="alert">
                {formError}
              </span>
            )}
            <label className="field">
              From
              <select className="select" value={methodId} onChange={(e) => setMethodId(e.target.value)}>
                {methods.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.longLabel}
                  </option>
                ))}
              </select>
            </label>
            {gateway.isTest && (
              <div className="test-hint">
                <strong>Test payments, no real money moves.</strong> End the amount in{' '}
                {gateway.triggers.map((t, i) => (
                  <span key={t.cents}>
                    {i > 0 && (i === gateway.triggers.length - 1 ? ' or ' : ', ')}
                    <code>.{String(t.cents).padStart(2, '0')}</code> ({t.outcome.toLowerCase()})
                  </span>
                ))}{' '}
                to simulate an error. Any other amount succeeds.
              </div>
            )}
            <button type="submit" className="btn btn-primary btn-block">
              Continue
            </button>
          </form>
        )}

        {step.name === 'processing' && (
          <>
            <div className="state-icon state-icon--info">
              <SpinnerIcon size={30} className="spin" />
            </div>
            <h2 id="add-funds-title">Processing your deposit</h2>
            <p id="add-funds-desc">
              We're confirming <strong className="num">{formatUSD(step.amountCents)}</strong> from {step.method.longLabel}.
              This usually takes under a minute.
            </p>
            <div
              className="progress"
              role="progressbar"
              aria-label="Deposit progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
            >
              <div style={{ width: `${progress}%` }} />
            </div>
            <span className="small">Please keep this window open.</span>
          </>
        )}

        {step.name === 'success' && (
          <>
            <div className="state-icon state-icon--success">
              <CheckIcon size={30} />
            </div>
            <h2 id="add-funds-title">Funds added</h2>
            <p id="add-funds-desc">
              <span className="num">{formatUSD(step.amountCents)}</span> is now in your available balance.
            </p>
            <dl className="details" style={{ margin: 0 }}>
              <div>
                <dt>Reference</dt>
                <dd>{step.reference}</dd>
              </div>
              <div>
                <dt>Fee</dt>
                <dd className="num">{formatUSD(step.feeCents)}</dd>
              </div>
            </dl>
            <button data-autofocus type="button" className="btn btn-dark btn-block" onClick={onClose}>
              Done
            </button>
          </>
        )}

        {step.name === 'error' && (
          <>
            <div className="state-icon state-icon--error">
              <AlertIcon size={30} />
            </div>
            <h2 id="add-funds-title">Transaction couldn't be completed</h2>
            <p id="add-funds-desc">{step.message} No money was taken from your account.</p>
            <dl className="details details--error" style={{ margin: 0 }}>
              <div>
                <dt>Error code</dt>
                <dd>{step.code}</dd>
              </div>
              {step.reference && (
                <div>
                  <dt>Reference</dt>
                  <dd>{step.reference}</dd>
                </div>
              )}
            </dl>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => onContactSupport(step.reference)}>
                Contact support
              </button>
              <button data-autofocus type="button" className="btn btn-primary" onClick={() => setStep({ name: 'form' })}>
                Try again
              </button>
            </div>
            <span className="small">Support opens a ticket with this reference attached.</span>
          </>
        )}
      </div>
    </div>
  );
}
