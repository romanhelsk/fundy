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

/** Banner for a suspended account or a pending transfer that's waiting on its deadline. */
export function AccountNotice({ account, pendingTransfer, now, audience = 'client' }: Props) {
  const admin = audience === 'admin';

  if (account.status === 'suspended') {
    const ref = account.expiredReference;
    return (
      <div className="account-notice account-notice--danger" role="alert">
        <AlertIcon size={20} />
        <div>
          <strong>{admin ? 'Account suspended' : 'Your account is suspended'}</strong>
          <p>
            {ref ? `Transfer ${ref} wasn't received within 12 hours. ` : ''}
            {admin
              ? 'The client can sign in and view their account, but can’t add or withdraw funds until you reactivate it.'
              : 'You can still view your account, but adding and withdrawing funds are disabled. Contact support to reactivate it.'}
          </p>
        </div>
      </div>
    );
  }

  if (pendingTransfer) {
    const left = timeLeft(pendingTransfer.dueAt, now);
    return (
      <div className="account-notice account-notice--warning" role="status">
        <LockIcon size={20} />
        <div>
          <strong>
            {admin ? 'Waiting for transfer' : 'Send your transfer'} {pendingTransfer.reference}:{' '}
            <span className="num">{formatUSD(pendingTransfer.amountCents)}</span>
          </strong>
          <p>
            {left ? (
              <>
                Due by <strong>{formatDueTime(pendingTransfer.dueAt)}</strong> ({left} left).{' '}
              </>
            ) : (
              <>The deadline has passed. </>
            )}
            {admin
              ? 'Mark it Completed when the funds arrive. If it isn’t received in time, the account is suspended automatically. Add and withdraw are paused for the client meanwhile.'
              : 'Adding and withdrawing funds are paused until we receive it. If it doesn’t arrive in time, your account will be suspended.'}
          </p>
        </div>
      </div>
    );
  }

  return null;
}
