import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import { BRAND_NAME } from '../config';
import { formatDate, formatUSD, splitUSD } from '../lib/format';
import { isInflow, txSubtitle, txTitle } from '../lib/transactions';
import type { Overview, Transaction, User } from '../types';
import { AddFundsModal } from './AddFundsModal';
import { AccountNotice } from './AccountNotice';
import { TransactionTable } from './TransactionTable';
import {
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

type TypeFilter = 'all' | 'Deposit' | 'Withdrawal' | 'Adjustment';

function matchesType(t: Transaction, f: TypeFilter) {
  if (f === 'all') return true;
  if (f === 'Adjustment') return t.type === 'Credit' || t.type === 'Debit';
  return t.type === f;
}
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

  // When a transfer deadline passes, refetch: the server suspends the account at that moment.
  const dueAt = data?.pendingTransfer?.dueAt;
  useEffect(() => {
    if (!dueAt) return;
    const ms = Date.parse(dueAt) - Date.now();
    const t = window.setTimeout(load, Math.max(ms, 0) + 1500);
    return () => window.clearTimeout(t);
  }, [dueAt, load]);

  const suspended = data?.account.status === 'suspended';
  const moneyBlocked = !data || suspended || data.pendingTransfer !== null;
  const blockedReason = suspended
    ? 'Your account is suspended.'
    : data?.pendingTransfer
      ? `Paused until transfer ${data.pendingTransfer.reference} is received.`
      : undefined;

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  const subtitle = useCallback((t: Transaction) => txSubtitle(t, data?.methodLabels ?? {}), [data]);

  const visible = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    const today = todayIso();
    return data.transactions.filter((t) => {
      if (!matchesType(t, typeFilter)) return false;
      if (period !== 'all' && daysBetween(t.date, today) > Number(period)) return false;
      if (!q) return true;
      return [t.id, txTitle(t), t.status, subtitle(t), formatDate(t.date)].some((s) => s.toLowerCase().includes(q));
    });
  }, [data, query, typeFilter, period, subtitle]);

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
      txTitle(t),
      subtitle(t),
      t.id,
      t.status,
      `${isInflow(t) ? '' : '-'}${(t.amountCents / 100).toFixed(2)}`,
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

        {data && <AccountNotice account={data.account} pendingTransfer={data.pendingTransfer} now={now} />}

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
              disabled={moneyBlocked || data?.methods.length === 0}
              title={blockedReason}
              aria-describedby={blockedReason ? 'money-blocked' : undefined}
            >
              <PlusIcon />
              Add funds
            </button>
            <button
              className="btn btn-outline-dark"
              onClick={() => showToast('Withdrawals are not available yet.')}
              disabled={moneyBlocked}
              title={blockedReason}
              aria-describedby={blockedReason ? 'money-blocked' : undefined}
            >
              <ArrowUpIcon />
              Withdraw
            </button>
            {blockedReason && (
              <span id="money-blocked" className="sr-only">
                {blockedReason}
              </span>
            )}
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
                  <option value="Adjustment">Adjustments</option>
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

          {data ? (
            <TransactionTable
              transactions={visible}
              methodLabels={data.methodLabels}
              emptyMessage={data.transactions.length === 0 ? "No transactions yet. Add funds to get started." : "No transactions match these filters."}
            />
          ) : (
            !loadError && <p className="empty">Loading transactions…</p>
          )}

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
