import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';
import { formatDueTime } from '../lib/deadline';
import { formatUSD, parseAmountToCents } from '../lib/format';
import type { PaymentMethod, PendingTransfer } from '../types';
import { FormError } from './AuthLayout';
import { CheckIcon } from './Icons';
import { Modal } from './Modal';

interface Props {
  availableCents: number;
  methods: PaymentMethod[];
  onClose: () => void;
  /** Called after a request is created so the dashboard can refresh (and lock). */
  onRequested: () => void;
  onSessionExpired: () => void;
}

export function WithdrawModal({ availableCents, methods, onClose, onRequested, onSessionExpired }: Props) {
  const banks = methods.filter((m) => m.kind === 'bank');
  const [amount, setAmount] = useState('');
  const [methodId, setMethodId] = useState(banks[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<PendingTransfer | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const cents = parseAmountToCents(amount);
    if (cents === null) return setError('Enter an amount greater than $0.00.');
    if (cents > availableCents) return setError(`You can withdraw up to ${formatUSD(availableCents)}.`);
    if (!methodId) return setError('Choose the bank account to send the wire to.');
    setError(null);
    setBusy(true);
    try {
      const res = await api.withdraw(cents, methodId);
      setDone(res.pendingTransfer);
      onRequested();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return onSessionExpired();
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Modal title="Withdrawal requested" onClose={onClose}>
        <div className="state-icon state-icon--success" style={{ alignSelf: 'center' }}>
          <CheckIcon size={30} />
        </div>
        <p>
          We'll send <strong className="num">{formatUSD(done.amountCents)}</strong> by wire to {done.methodLabel}. The
          amount is on hold until the wire goes out.
        </p>
        <dl className="details" style={{ margin: 0 }}>
          <div>
            <dt>Reference</dt>
            <dd>{done.reference}</dd>
          </div>
          <div>
            <dt>Expected by</dt>
            <dd>{formatDueTime(done.dueAt)}</dd>
          </div>
        </dl>
        <span className="small">Adding and withdrawing funds are paused until this withdrawal is completed.</span>
        <button type="button" className="btn btn-dark btn-block" onClick={onClose} data-autofocus>
          Done
        </button>
      </Modal>
    );
  }

  return (
    <Modal title="Withdraw" description="Send money by wire to one of your linked bank accounts." onClose={onClose} locked={busy}>
      {banks.length === 0 ? (
        <>
          <p className="small">
            You don't have a linked bank account. Contact support to link one before withdrawing.
          </p>
          <button type="button" className="btn btn-secondary btn-block" onClick={onClose} data-autofocus>
            Close
          </button>
        </>
      ) : (
        <form onSubmit={submit} noValidate className="form-stack">
          <label className="field">
            Amount (USD)
            <input
              data-autofocus
              className="input num"
              inputMode="decimal"
              placeholder="10,000.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-describedby="withdraw-available"
            />
            <span id="withdraw-available" className="small" style={{ fontWeight: 400 }}>
              Available: <span className="num">{formatUSD(availableCents)}</span>
            </span>
          </label>
          <label className="field">
            To
            <select className="select" value={methodId} onChange={(e) => setMethodId(e.target.value)}>
              {banks.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.longLabel}
                </option>
              ))}
            </select>
          </label>
          <div className="test-hint">
            The withdrawal stays <strong>pending</strong> until the wire is sent, within 12 hours. Adding and
            withdrawing funds are paused until then.
          </div>
          <FormError id="withdraw-error" message={error} />
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Requesting…' : 'Request withdrawal'}
          </button>
        </form>
      )}
    </Modal>
  );
}
