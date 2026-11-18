import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import { BRAND_NAME } from '../config';
import { formatDate, formatUSD, signedUSD, splitUSD } from '../lib/format';
import type { Overview, TxType, User } from '../types';
import { AddFundsModal } from './AddFundsModal';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BellIcon,
  CardIcon,
  LogoIcon,
  OverviewIcon,
  PlusIcon,
  SettingsIcon,
  StatementIcon,
  TransactionsIcon,
} from './Icons';

interface Props {
  user: User;
  onSignOut: () => void;
  onSessionExpired: () => void;
}

const NAV = [
  { label: 'Overview', href: '#overview', icon: OverviewIcon },
  { label: 'Transactions', href: '#transactions', icon: TransactionsIcon },
  { label: 'Payment methods', href: '#payment-methods', icon: CardIcon },
  { label: 'Statements', href: '#statements', icon: StatementIcon },
  { label: 'Settings', href: '#settings', icon: SettingsIcon },
];

type TypeFilter = 'all' | TxType;
type PeriodFilter = '7' | '30' | 'all';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function daysBetween(fromIso: string, toIso: string) {
  return (Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000;
}
function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}
function minutesAgo(iso: string, now: number) {
  const m = Math.floor((now - Date.parse(iso)) / 60_000);
  return m < 1 ? 'just now' : `${m} min ago`;
}

export function Dashboard({ user, onSignOut, onSessionExpired }: Props) {
  const [data, setData] = useState<Overview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [now, setNow] = useState(Date.now());

  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [period, setPeriod] = useState<PeriodFilter>('30');

  const addFundsBtn = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.overview());
      setLoadError(null);
      setNow(Date.now());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return onSessionExpired();
      setLoadError(err instanceof ApiError ? err.message : 'Could not load your account.');
    }
  }, [onSessionExpired]);

  useEffect(() => {
    load();
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, [load]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  const methodLabel = useCallback(
    (id: string) => data?.methods.find((m) => m.id === id)?.longLabel ?? 'Unknown method',
    [data],
  );

  const visible = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    const today = todayIso();
    return data.transactions.filter((t) => {
      if (typeFilter !== 'all' && t.type !== typeFilter) return false;
      if (period !== 'all' && daysBetween(t.date, today) > Number(period)) return false;
      if (!q) return true;
      return [t.id, t.type, t.status, methodLabel(t.methodId), formatDate(t.date)].some((s) => s.toLowerCase().includes(q));
    });
  }, [data, query, typeFilter, period, methodLabel]);

  function closeModal() {
    setModalOpen(false);
    addFundsBtn.current?.focus();
  }

  function contactSupport(reference: string | null) {
    // TODO: open an in-app ticket via the client's ticketing system.
    closeModal();
    showToast(reference ? `Support ticket opened with reference ${reference} attached.` : 'Support ticket opened.');
  }

  function exportCsv() {
    const header = ['Date', 'Type', 'Method', 'Reference', 'Status', 'Amount (USD)'];
    const lines = visible.map((t) => [
      t.date,
      t.type,
      methodLabel(t.methodId),
      t.id,
      t.status,
      `${t.type === 'Deposit' ? '' : '-'}${(t.amountCents / 100).toFixed(2)}`,
    ]);
    const csv = [header, ...lines].map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `transactions-${todayIso()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const [whole, cents] = data ? splitUSD(data.balance.availableCents) : ['—', ''];

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Main">
        <div className="brand">
          <span className="brand-mark">
            <LogoIcon />
          </span>
          <span>{BRAND_NAME}</span>
        </div>
        <ul className="nav">
          {NAV.map(({ label, href, icon: Icon }) => (
            <li key={label}>
              <a href={href} aria-current={label === 'Overview' ? 'page' : undefined}>
                <Icon />
                {label}
              </a>
            </li>
          ))}
        </ul>
        <div className="help-card">
          <strong>Need help?</strong>
          <span>Open a ticket from the Help Center. Our team replies in-app.</span>
          <a href="#help-center">Help Center</a>
        </div>
      </nav>

      <main className="main" aria-busy={!data}>
        <header className="page-header">
          <div>
            <h1>Overview</h1>
            <span className="muted">Welcome back, {user.name}</span>
          </div>
          <div className="header-actions">
            {data?.gateway.isTest && <span className="demo-tag">Test payments</span>}
            <button className="icon-btn" aria-label="Notifications">
              <BellIcon />
            </button>
            <div className="menu-wrap">
              <button
                className="account-btn"
                aria-label="Account menu"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((o) => !o)}
              >
                <span className="avatar" aria-hidden="true">
                  {initials(user.name)}
                </span>
                Account
              </button>
              {menuOpen && (
                <div className="menu" role="menu">
                  <div className="menu-user">
                    <strong>{user.name}</strong>
                    <span>{user.email}</span>
                  </div>
                  <button role="menuitem" onClick={onSignOut}>
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {loadError && (
          <div className="banner-error" role="alert">
            {loadError}{' '}
            <button className="link-btn" onClick={load}>
              Retry
            </button>
          </div>
        )}

        <section className="balance" aria-label="Balance">
          <div>
            <span className="balance-label">Available balance · USD</span>
            <div className="balance-amount num">
              <span className="whole">{whole}</span>
              <span className="cents">{cents}</span>
            </div>
            {data && (
              <div className="balance-meta num">
                <span>
                  Pending <strong>{formatUSD(data.balance.pendingCents)}</strong>
                </span>
                <span>
                  Total <strong>{formatUSD(data.balance.totalCents)}</strong>
                </span>
                <span>Updated {minutesAgo(data.balance.asOf, now)}</span>
              </div>
            )}
          </div>
          <div className="balance-actions">
            <button
              ref={addFundsBtn}
              className="btn btn-white"
              onClick={() => setModalOpen(true)}
              disabled={!data || data.methods.length === 0}
            >
              <PlusIcon />
              Add funds
            </button>
            <button className="btn btn-outline-dark" onClick={() => showToast('Withdrawals are not available yet.')}>
              <ArrowUpIcon />
              Withdraw
            </button>
          </div>
        </section>

        {data && (
          <section className="summary" aria-label="Summary">
            <div className="stat">
              <span className="stat-label">Deposits this month</span>
              <span className="stat-value num">{formatUSD(data.summary.depositsCents)}</span>
              <span className="stat-detail stat-detail--success">{data.summary.depositsCount} completed</span>
            </div>
            <div className="stat">
              <span className="stat-label">Withdrawals this month</span>
              <span className="stat-value num">{formatUSD(data.summary.withdrawalsCents)}</span>
              <span className="stat-detail">{data.summary.withdrawalsCount} completed</span>
            </div>
            <div className="stat">
              <span className="stat-label">Pending transactions</span>
              <span className="stat-value num">{data.summary.pendingCount}</span>
              <span className="stat-detail stat-detail--warning">Awaiting confirmation</span>
            </div>
            <div className="stat">
              <span className="stat-label">Linked accounts</span>
              <span className="stat-value num">{data.methods.length}</span>
              <span className="stat-detail">{data.methods.map((m) => m.label).join(', ')}</span>
            </div>
          </section>
        )}

        <section className="panel" aria-labelledby="tx-heading">
          <div className="panel-head">
            <h2 id="tx-heading">Transaction history</h2>
            <div className="toolbar">
              <label>
                <span className="sr-only">Search transactions</span>
                <input
                  className="input"
                  type="search"
                  placeholder="Search transactions"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <label>
                <span className="sr-only">Transaction type</span>
                <select className="select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}>
                  <option value="all">All types</option>
                  <option value="Deposit">Deposits</option>
                  <option value="Withdrawal">Withdrawals</option>
                </select>
              </label>
              <label>
                <span className="sr-only">Period</span>
                <select className="select" value={period} onChange={(e) => setPeriod(e.target.value as PeriodFilter)}>
                  <option value="7">Last 7 days</option>
                  <option value="30">Last 30 days</option>
                  <option value="all">All time</option>
                </select>
              </label>
              <button className="btn btn-secondary" onClick={exportCsv} disabled={visible.length === 0}>
                Export CSV
              </button>
            </div>
          </div>

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
                </tr>
              </thead>
              <tbody>
                {visible.map((t) => {
                  const isIn = t.type === 'Deposit';
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
                            <strong>{t.type}</strong>
                            <small>{methodLabel(t.methodId)}</small>
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
                    </tr>
                  );
                })}
                {data && visible.length === 0 && (
                  <tr>
                    <td colSpan={5} className="empty">
                      {data.transactions.length === 0 ? 'No transactions yet. Add funds to get started.' : 'No transactions match these filters.'}
                    </td>
                  </tr>
                )}
                {!data && !loadError && (
                  <tr>
                    <td colSpan={5} className="empty">
                      Loading transactions…
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {data && (
            <div className="panel-foot">
              <span>
                Showing {visible.length} of {data.totalCount}
              </span>
              <a href="#transactions">View all transactions</a>
            </div>
          )}
        </section>
      </main>

      {modalOpen && data && (
        <AddFundsModal
          methods={data.methods}
          gateway={data.gateway}
          onClose={closeModal}
          onSettled={load}
          onContactSupport={contactSupport}
          onSessionExpired={onSessionExpired}
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
    </div>
  );
}
