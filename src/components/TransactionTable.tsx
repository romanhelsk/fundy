import type { ReactNode } from 'react';
import { formatDate, signedUSD } from '../lib/format';
import { isInflow, txSubtitle, txTitle } from '../lib/transactions';
import type { Transaction } from '../types';
import { ArrowDownIcon, ArrowUpIcon } from './Icons';

interface Props {
  transactions: Transaction[];
  methodLabels: Record<string, string>;
  emptyMessage: string;
  /** Optional extra column (admin actions). */
  actions?: (t: Transaction) => ReactNode;
}

export function TransactionTable({ transactions, methodLabels, emptyMessage, actions }: Props) {
  const cols = actions ? 6 : 5;
  return (
    <div className="table-scroll">
      <table className="tx-table">
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Description</th>
            <th scope="col">Reference</th>
            <th scope="col">Status</th>
            <th scope="col" className="right">
              Amount
            </th>
            {actions && (
              <th scope="col" className="right">
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {transactions.map((t) => {
            const isIn = isInflow(t);
            const failed = t.status === 'Failed';
            const amountClass = failed ? 'tx-amount--failed' : isIn ? 'tx-amount--in' : '';
            return (
              <tr key={t.id}>
                <td className="tx-date">{formatDate(t.date)}</td>
                <td>
                  <div className="tx-desc">
                    <span className={`tx-icon ${isIn ? 'tx-icon--in' : 'tx-icon--out'}`}>
                      {isIn ? <ArrowDownIcon size={16} /> : <ArrowUpIcon size={16} />}
                    </span>
                    <div>
                      <strong>{txTitle(t)}</strong>
                      <small>{txSubtitle(t, methodLabels)}</small>
                    </div>
                  </div>
                </td>
                <td className="tx-ref">{t.id}</td>
                <td>
                  <span className={`pill pill--${t.status.toLowerCase()}`} title={t.errorCode ?? undefined}>
                    {t.status}
                  </span>
                </td>
                <td className={`right tx-amount ${amountClass}`}>
                  {failed && <span className="sr-only">Failed, not counted: </span>}
                  {signedUSD(t.amountCents, isIn ? '+' : '−')}
                </td>
                {actions && <td className="right">{actions(t)}</td>}
              </tr>
            );
          })}
          {transactions.length === 0 && (
            <tr>
              <td colSpan={cols} className="empty">
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
