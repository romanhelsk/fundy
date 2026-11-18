import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../../api';
import { formatUSD, parseAmountToCents } from '../../lib/format';
import type { AuditEntry, ClientDetail, PaymentMethod, Transaction, User } from '../../types';
import { FormError } from '../AuthLayout';
import { CardIcon, PlusIcon } from '../Icons';
import { Modal } from '../Modal';
import { TransactionTable } from '../TransactionTable';
import { TemporaryPasswordModal } from './TemporaryPassword';

interface Props {
  clientId: number;
  onBack: () => void;
  onSessionExpired: () => void;
}

type Dialog =
  | null
  | 'adjust'
  | 'link'
  | 'reset'
  | { resetDone: { user: User; temporaryPassword: string } }
  | { remove: PaymentMethod }
  | { settle: Transaction; status: 'Completed' | 'Failed' };

function errorMessage(err: unknown, fallback: string) {
  return err instanceof ApiError ? err.message : fallback;
}

export function AdminClientDetail({ clientId, onBack, onSessionExpired }: Props) {
  const [data, setData] = useState<ClientDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.admin.client(clientId));
      setLoadError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return onSessionExpired();
      setLoadError(errorMessage(err, 'Could not load this client.'));
    }
  }, [clientId, onSessionExpired]);

  useEffect(() => {
    load();
  }, [load]);

  /** Shared wrapper for dialog actions: run, refresh, close, announce. */
  const runAction = useCallback(
    async (fn: () => Promise<unknown>, done: string) => {
      try {
        await fn();
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          onSessionExpired();
          return null;
        }
        return errorMessage(err, 'Something went wrong. Please try again.');
      }
      setDialog(null);
      setToast(done);
      window.setTimeout(() => setToast(null), 4000);
      await load();
      return null;
    },
    [load, onSessionExpired],
  );

  if (loadError) {
    return (
      <div className="banner-error" role="alert">
        {loadError}{' '}
        <button className="link-btn" onClick={onBack}>
          Back to clients
        </button>
      </div>
    );
  }
  if (!data) return <p className="empty">Loading client…</p>;

  const { user, balance } = data;

  return (
    <>
      <div>
        <button className="link-btn" onClick={onBack}>
          ← All clients
        </button>
      </div>

      <section className="balance" aria-label={`${user.name} balance`}>
        <div>
          <span className="balance-label">{user.name} · {user.email}</span>
          <div className="balance-amount num">
            <span className="whole">{formatUSD(balance.availableCents)}</span>
          </div>
          <div className="balance-meta num">
            <span>
              Pending <strong>{formatUSD(balance.pendingCents)}</strong>
            </span>
            <span>
              Total <strong>{formatUSD(balance.totalCents)}</strong>
            </span>
            <span>Client since {user.createdAt.slice(0, 10)}</span>
            {user.mustChangePassword && <span>Awaiting first sign-in</span>}
          </div>
        </div>
        <div className="balance-actions">
          <button className="btn btn-white" onClick={() => setDialog('adjust')}>
            <PlusIcon />
            Adjust balance
          </button>
          <button className="btn btn-outline-dark" onClick={() => setDialog('reset')}>
            Reset password
          </button>
        </div>
      </section>

      <section className="panel" aria-labelledby="methods-heading">
        <div className="panel-head">
          <h2 id="methods-heading">Linked accounts</h2>
          <button className="btn btn-secondary btn-sm" onClick={() => setDialog('link')}>
            <PlusIcon size={16} />
            Link account
          </button>
        </div>
        {data.methods.length === 0 ? (
          <p className="empty">No linked accounts. The client can't add funds until one is linked.</p>
        ) : (
          <ul className="method-list">
            {data.methods.map((m) => (
              <li key={m.id}>
                <span className="tx-icon tx-icon--out" aria-hidden="true">
                  <CardIcon size={16} />
                </span>
                <div>
                  <strong>{m.longLabel}</strong>
                  <small className="block muted">{m.kind === 'bank' ? 'Bank account' : 'Card'}</small>
                </div>
                <button className="btn btn-secondary btn-sm" onClick={() => setDialog({ remove: m })}>
                  Remove<span className="sr-only"> {m.longLabel}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel" aria-labelledby="client-tx-heading">
        <div className="panel-head">
          <h2 id="client-tx-heading">Transactions</h2>
          <span className="muted" style={{ fontSize: 13 }}>
            Latest {data.transactions.length} of {data.totalCount}
          </span>
        </div>
        <TransactionTable
          transactions={data.transactions}
          methodLabels={data.methodLabels}
          emptyMessage="No transactions yet."
          actions={(t) =>
            t.status === 'Pending' ? (
              <span className="row-actions">
                <button className="btn btn-secondary btn-sm" onClick={() => setDialog({ settle: t, status: 'Completed' })}>
                  Complete<span className="sr-only"> {t.id}</span>
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => setDialog({ settle: t, status: 'Failed' })}>
                  Fail<span className="sr-only"> {t.id}</span>
                </button>
              </span>
            ) : null
          }
        />
      </section>

      <section className="panel" aria-labelledby="audit-heading">
        <div className="panel-head">
          <h2 id="audit-heading">Admin activity</h2>
        </div>
        {data.audit.length === 0 ? (
          <p className="empty">No admin changes yet.</p>
        ) : (
          <ul className="audit-list">
            {data.audit.map((a) => (
              <li key={a.id}>
                <span>{describeAudit(a)}</span>
                <small className="muted">
                  {a.adminName} · {a.createdAt} UTC
                </small>
              </li>
            ))}
          </ul>
        )}
      </section>

      {dialog === 'adjust' && (
        <AdjustModal
          available={balance.availableCents}
          onClose={() => setDialog(null)}
          onSubmit={(body) =>
            runAction(
              () => api.admin.adjust(user.id, body),
              `${body.direction === 'credit' ? 'Credited' : 'Debited'} ${formatUSD(body.amountCents)}${body.status === 'Pending' ? ' as pending' : ''}.`,
            )
          }
        />
      )}
      {dialog === 'reset' && (
        <ConfirmModal
          title="Reset password?"
          body={`${user.name} gets a new temporary password and must set their own at the next sign-in. Their current password stops working and they're signed out everywhere.`}
          confirmLabel="Reset password"
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            try {
              const result = await api.admin.resetPassword(user.id);
              setDialog({ resetDone: result });
              await load();
              return null;
            } catch (err) {
              if (err instanceof ApiError && err.status === 401) {
                onSessionExpired();
                return null;
              }
              return errorMessage(err, 'Could not reset the password.');
            }
          }}
        />
      )}
      {dialog && typeof dialog === 'object' && 'resetDone' in dialog && (
        <TemporaryPasswordModal
          title="Password reset"
          user={dialog.resetDone.user}
          temporaryPassword={dialog.resetDone.temporaryPassword}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'link' && (
        <LinkMethodModal
          onClose={() => setDialog(null)}
          onSubmit={(body) => runAction(() => api.admin.linkMethod(user.id, body), 'Account linked.')}
        />
      )}
      {dialog && typeof dialog === 'object' && 'remove' in dialog && (
        <ConfirmModal
          title="Remove linked account?"
          body={`${dialog.remove.longLabel} will no longer be available for deposits. Past transactions keep showing it.`}
          confirmLabel="Remove account"
          onClose={() => setDialog(null)}
          onConfirm={() => runAction(() => api.admin.removeMethod(user.id, dialog.remove.id), 'Account removed.')}
        />
      )}
      {dialog && typeof dialog === 'object' && 'settle' in dialog && (
        <ConfirmModal
          title={dialog.status === 'Completed' ? 'Complete this transaction?' : 'Mark this transaction as failed?'}
          body={
            dialog.status === 'Completed'
              ? `${dialog.settle.id} (${formatUSD(dialog.settle.amountCents)}) moves from pending into the available balance.`
              : `${dialog.settle.id} (${formatUSD(dialog.settle.amountCents)}) is removed from pending and never reaches the balance.`
          }
          confirmLabel={dialog.status === 'Completed' ? 'Complete' : 'Mark as failed'}
          onClose={() => setDialog(null)}
          onConfirm={() =>
            runAction(
              () => api.admin.settle(user.id, dialog.settle.id, dialog.status),
              `${dialog.settle.id} marked ${dialog.status.toLowerCase()}.`,
            )
          }
        />
      )}

      <div className="sr-only" role="status" aria-live="polite">
        {toast}
      </div>
      {toast && (
        <div className="toast" aria-hidden="true">
          {toast}
        </div>
      )}
    </>
  );
}

function describeAudit(a: AuditEntry): string {
  const d = a.details as Record<string, string | number>;
  const amount = typeof d.amountCents === 'number' ? formatUSD(d.amountCents) : '';
  switch (a.action) {
    case 'user.create':
      return `Created the account (${d.email})`;
    case 'user.reset_password':
      return 'Reset the password (temporary password issued, sessions revoked)';
    case 'balance.credit':
      return `Credited ${amount}${d.status === 'Pending' ? ' as pending' : ''}: ${d.note} (${d.reference})`;
    case 'balance.debit':
      return `Debited ${amount}: ${d.note} (${d.reference})`;
    case 'transaction.settle':
      return `Marked ${d.reference} (${amount}) as ${String(d.status).toLowerCase()}`;
    case 'method.link':
      return `Linked ${d.label}`;
    case 'method.remove':
      return `Removed ${d.label}`;
    default:
      return a.action;
  }
}

// ---------- Dialogs ----------
type SubmitResult = Promise<string | null>; // error message, or null on success

function AdjustModal({
  available,
  onClose,
  onSubmit,
}: {
  available: number;
  onClose: () => void;
  onSubmit: (body: { direction: 'credit' | 'debit'; amountCents: number; status: 'Completed' | 'Pending'; note: string }) => SubmitResult;
}) {
  const [direction, setDirection] = useState<'credit' | 'debit'>('credit');
  const [status, setStatus] = useState<'Completed' | 'Pending'>('Completed');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const cents = parseAmountToCents(amount);
    if (cents === null) return setError('Enter an amount greater than $0.00.');
    if (direction === 'debit' && cents > available) return setError(`A debit can't exceed the available ${formatUSD(available)}.`);
    if (!note.trim()) return setError('Add a reason. It is shown to the client and kept in the activity log.');
    setError(null);
    setBusy(true);
    const err = await onSubmit({ direction, amountCents: cents, status: direction === 'debit' ? 'Completed' : status, note: note.trim() });
    setBusy(false);
    if (err) setError(err);
  }

  return (
    <Modal title="Adjust balance" description="Adds a ledger entry. The client sees it in their transaction history." onClose={onClose} locked={busy}>
      <form onSubmit={submit} noValidate className="form-stack">
        <fieldset className="segmented">
          <legend className="sr-only">Direction</legend>
          <label>
            <input type="radio" name="direction" checked={direction === 'credit'} onChange={() => setDirection('credit')} data-autofocus />
            Credit (add)
          </label>
          <label>
            <input type="radio" name="direction" checked={direction === 'debit'} onChange={() => setDirection('debit')} />
            Debit (subtract)
          </label>
        </fieldset>
        <label className="field">
          Amount (USD)
          <input className="input num" inputMode="decimal" placeholder="10,000.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        {direction === 'credit' && (
          <label className="field">
            Status
            <select className="select" value={status} onChange={(e) => setStatus(e.target.value as 'Completed' | 'Pending')}>
              <option value="Completed">Completed: add to available balance now</option>
              <option value="Pending">Pending: show as pending until settled</option>
            </select>
          </label>
        )}
        <label className="field">
          Reason
          <input className="input" maxLength={200} placeholder="e.g. Opening balance transfer" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <FormError id="adjust-error" message={error} />
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Saving…' : direction === 'credit' ? 'Credit balance' : 'Debit balance'}
        </button>
      </form>
    </Modal>
  );
}

function LinkMethodModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (body: { kind: 'bank' | 'card'; last4: string; institution: string }) => SubmitResult;
}) {
  const [kind, setKind] = useState<'bank' | 'card'>('bank');
  const [last4, setLast4] = useState('');
  const [institution, setInstitution] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!/^\d{4}$/.test(last4)) return setError('Enter the last 4 digits.');
    setError(null);
    setBusy(true);
    const err = await onSubmit({ kind, last4, institution: institution.trim() });
    setBusy(false);
    if (err) setError(err);
  }

  return (
    <Modal
      title="Link account"
      description="Only the last 4 digits are stored. With the test gateway, no real account is verified."
      onClose={onClose}
      locked={busy}
    >
      <form onSubmit={submit} noValidate className="form-stack">
        <label className="field">
          Type
          <select className="select" value={kind} onChange={(e) => setKind(e.target.value as 'bank' | 'card')} data-autofocus>
            <option value="bank">Bank account</option>
            <option value="card">Card</option>
          </select>
        </label>
        <label className="field">
          {kind === 'bank' ? 'Bank name' : 'Card issuer'} (optional)
          <input className="input" maxLength={60} value={institution} onChange={(e) => setInstitution(e.target.value)} />
        </label>
        <label className="field">
          Last 4 digits
          <input
            className="input num"
            inputMode="numeric"
            maxLength={4}
            placeholder="4417"
            value={last4}
            onChange={(e) => setLast4(e.target.value.replace(/\D/g, ''))}
          />
        </label>
        <FormError id="link-error" message={error} />
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Linking…' : 'Link account'}
        </button>
      </form>
    </Modal>
  );
}

function ConfirmModal({
  title,
  body,
  confirmLabel,
  onClose,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => SubmitResult;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    const err = await onConfirm();
    setBusy(false);
    if (err) setError(err);
  }

  return (
    <Modal title={title} description={body} onClose={onClose} locked={busy}>
      <FormError id="confirm-error" message={error} />
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy} data-autofocus>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" onClick={confirm} disabled={busy}>
          {busy ? 'Saving…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
