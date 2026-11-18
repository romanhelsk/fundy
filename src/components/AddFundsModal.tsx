import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { paymentMethods, methodById, type PaymentMethod } from '../data/demo';
import { formatUSD, parseAmountToCents } from '../lib/format';
import { AlertIcon, CheckIcon, CloseIcon, SpinnerIcon } from './Icons';

export interface DepositResult {
  ok: boolean;
  reference: string;
  amountCents: number;
  methodId: string;
  feeCents: number;
  errorCode?: string;
  errorMessage?: string;
}

interface Props {
  nextReference: () => string;
  onClose: () => void;
  onCompleted: (result: DepositResult) => void;
  onContactSupport: (reference: string) => void;
}

type Step =
  | { name: 'form' }
  | { name: 'processing'; amountCents: number; method: PaymentMethod }
  | { name: 'done'; result: DepositResult };

/**
 * Demo payment provider. Bank transfers succeed; card deposits are declined,
 * so the error state can be shown. Replace with the real provider once chosen.
 */
function simulateProvider(amountCents: number, method: PaymentMethod, reference: string): DepositResult {
  if (method.kind === 'card') {
    return {
      ok: false,
      reference,
      amountCents,
      methodId: method.id,
      feeCents: 0,
      errorCode: 'CARD_DECLINED',
      errorMessage: 'Your card issuer declined this deposit.',
    };
  }
  return { ok: true, reference, amountCents, methodId: method.id, feeCents: 0 };
}

const PROCESSING_MS = 2400;

export function AddFundsModal({ nextReference, onClose, onCompleted, onContactSupport }: Props) {
  const [step, setStep] = useState<Step>({ name: 'form' });
  const [amount, setAmount] = useState('');
  const [methodId, setMethodId] = useState(paymentMethods[0].id);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Move focus into the dialog whenever the step changes.
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const target = el.querySelector<HTMLElement>('[data-autofocus]') ?? el;
    target.focus();
  }, [step.name]);

  // Escape closes, except while a deposit is processing.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && step.name !== 'processing') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [step.name, onClose]);

  // Simulated processing.
  useEffect(() => {
    if (step.name !== 'processing') return;
    setProgress(10);
    const tick = window.setInterval(() => setProgress((p) => Math.min(p + 15, 90)), 300);
    const done = window.setTimeout(() => {
      const result = simulateProvider(step.amountCents, step.method, nextReference());
      setProgress(100);
      onCompleted(result);
      setStep({ name: 'done', result });
    }, PROCESSING_MS);
    return () => {
      window.clearInterval(tick);
      window.clearTimeout(done);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.name]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const cents = parseAmountToCents(amount);
    if (cents === null) {
      setError('Enter an amount greater than $0.00.');
      return;
    }
    setError(null);
    setStep({ name: 'processing', amountCents: cents, method: methodById(methodId) });
  }

  function retry() {
    setStep({ name: 'form' });
  }

  // Keep Tab inside the dialog.
  function trapTab(e: ReactKeyboardEvent) {
    if (e.key !== 'Tab' || !dialogRef.current) return;
    const items = dialogRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input, select, a[href]',
    );
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
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

  const isError = step.name === 'done' && !step.result.ok;

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
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'amount-error' : undefined}
              />
            </label>
            {error && (
              <span id="amount-error" className="field-error" role="alert">
                {error}
              </span>
            )}
            <label className="field">
              From
              <select className="select" value={methodId} onChange={(e) => setMethodId(e.target.value)}>
                {paymentMethods.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.longLabel}
                  </option>
                ))}
              </select>
            </label>
            <span className="small">Demo: card deposits are declined so you can see the error state.</span>
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
              We're confirming <strong className="num">{formatUSD(step.amountCents)}</strong> from{' '}
              {step.method.longLabel}. This usually takes under a minute.
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

        {step.name === 'done' && step.result.ok && (
          <>
            <div className="state-icon state-icon--success">
              <CheckIcon size={30} />
            </div>
            <h2 id="add-funds-title">Funds added</h2>
            <p id="add-funds-desc">
              <span className="num">{formatUSD(step.result.amountCents)}</span> is now in your available balance.
            </p>
            <dl className="details" style={{ margin: 0 }}>
              <div>
                <dt>Reference</dt>
                <dd>{step.result.reference}</dd>
              </div>
              <div>
                <dt>Fee</dt>
                <dd className="num">{formatUSD(step.result.feeCents)}</dd>
              </div>
            </dl>
            <button data-autofocus type="button" className="btn btn-dark btn-block" onClick={onClose}>
              Done
            </button>
          </>
        )}

        {isError && step.name === 'done' && (
          <>
            <div className="state-icon state-icon--error">
              <AlertIcon size={30} />
            </div>
            <h2 id="add-funds-title">Transaction couldn't be completed</h2>
            <p id="add-funds-desc">
              {step.result.errorMessage} No money was taken from your account.
            </p>
            <dl className="details details--error" style={{ margin: 0 }}>
              <div>
                <dt>Error code</dt>
                <dd>{step.result.errorCode}</dd>
              </div>
              <div>
                <dt>Reference</dt>
                <dd>{step.result.reference}</dd>
              </div>
            </dl>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => onContactSupport(step.result.reference)}
              >
                Contact support
              </button>
              <button data-autofocus type="button" className="btn btn-primary" onClick={retry}>
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
