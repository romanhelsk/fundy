import type { ReactNode } from 'react';
import { formatDueTime, timeLeft } from '../lib/deadline';
import { formatUSD } from '../lib/format';
import type { AccountStatus, PendingTransfer } from '../types';
import { AlertIcon, LockIcon } from './Icons';

interface Props {
  account: AccountStatus;
  pendingTransfer: PendingTransfer | null;
  now: number;
  /** Text adapted for the admin console ("The client…") instead of the client ("You…"). */
  audience?: 'client' | 'admin';
}

/** Banner for a suspended account or a pending transaction that's waiting on its 12-hour deadline. */
export function AccountNotice({ account, pendingTransfer, now, audience = 'client' }: Props) {
  const admin = audience === 'admin';

  if (account.status === 'suspended') {
    const ref = account.expiredReference;
    const cause = !ref
      ? ''
      : account.suspendedReason === 'WITHDRAWAL_NOT_COMPLETED'
        ? `Withdrawal ${ref} wasn't completed within 12 hours and was cancelled; the funds are back in the balance. `
        : `Transfer ${ref} wasn't received within 12 hours. `;
    return (
      <div className="account-notice account-notice--danger" role="alert">
        <AlertIcon size={20} />
        <div>
          <strong>{admin ? 'Account suspended' : 'Your account is suspended'}</strong>
          <p>
            {cause}
            {admin
              ? 'The client can sign in and view their account, but can’t add or withdraw funds until you reactivate it.'
              : 'You can still view your account, but adding and withdrawing funds are disabled. Contact support to reactivate it.'}
          </p>
        </div>
      </div>
    );
  }

  if (!pendingTransfer) return null;

  const left = timeLeft(pendingTransfer.dueAt, now);
  const amount = <span className="num">{formatUSD(pendingTransfer.amountCents)}</span>;
  const due = left ? (
    <>
      Due by <strong>{formatDueTime(pendingTransfer.dueAt)}</strong> ({left} left).{' '}
    </>
  ) : (
    <>The deadline has passed. </>
  );
  const to = pendingTransfer.methodLabel ? ` to ${pendingTransfer.methodLabel}` : '';

  let title: ReactNode;
  let body: string;
  if (pendingTransfer.direction === 'out') {
    title = (
      <>
        {admin ? 'Withdrawal to send' : 'Withdrawal in progress'} {pendingTransfer.reference}: {amount}
        {to}
      </>
    );
    body = admin
      ? 'Send the wire and mark it Completed, or mark it Failed to release the hold. If neither happens in time, it’s cancelled and the account is suspended automatically. Add and withdraw are paused for the client meanwhile.'
      : 'The amount is on hold until the wire goes out. Adding and withdrawing funds are paused until then.';
  } else {
    title = (
      <>
        {admin ? 'Waiting for transfer' : 'Send your transfer'} {pendingTransfer.reference}: {amount}
      </>
    );
    body = admin
      ? 'Mark it Completed when the funds arrive. If it isn’t received in time, the account is suspended automatically. Add and withdraw are paused for the client meanwhile.'
      : 'Adding and withdrawing funds are paused until we receive it. If it doesn’t arrive in time, your account will be suspended.';
  }

  return (
    <div className="account-notice account-notice--warning" role="status">
      <LockIcon size={20} />
      <div>
        <strong>{title}</strong>
        <p>
          {due}
          {body}
        </p>
      </div>
    </div>
  );
}
