import { useCallback, useMemo, useRef, useState } from 'react';
import {
  BRAND_NAME,
  CLIENT_INITIALS,
  CLIENT_NAME,
  DEMO_TODAY,
  IS_DEMO,
  TOTAL_TX_COUNT,
  initialBalance,
  initialTransactions,
  methodById,
  monthSummary,
  paymentMethods,
  type Transaction,
  type TxType,
} from '../data/demo';
import { formatDate, formatUSD, signedUSD, splitUSD } from '../lib/format';
import { AddFundsModal, type DepositResult } from './AddFundsModal';
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
  onSignOut: () => void;
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

function daysBetween(fromIso: string, toIso: string) {
  return (Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000;
}

export function Dashboard({ onSignOut }: Props) {
  const [transactions, setTransactions] = useState<Transaction[]>(initialTransactions);
  const [availableCents, setAvailableCents] = useState(initialBalance.availableCents);
  const [summary, setSummary] = useState(monthSummary);
  const [modalOpen, setModalOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [period, setPeriod] = useState<PeriodFilter>('30');

  const addFundsBtn = useRef<HTMLButtonElement>(null);
  const refCounter = useRef(80412);

  const pendingCents = initialBalance.pendingCents;
  const totalCents = availableCents + pendingCents;
  const [whole, cents] = splitUSD(availableCents);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  const nextReference = useCallback(() => `TX-${++refCounter.current}`, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return transactions.filter((t) => {
      if (typeFilter !== 'all' && t.type !== typeFilter) return false;
      if (period !== 'all' && daysBetween(t.date, DEMO_TODAY) > Number(period)) return false;
      if (!q) return true;
      const m = methodById(t.methodId);
      return [t.id, t.type, t.status, m.longLabel, formatDate(t.date)].some((s) => s.toLowerCase().includes(q));
    });
  }, [transactions, query, typeFilter, period]);

  function handleDeposit(result: DepositResult) {
    const tx: Transaction = {
      id: result.reference,
      date: DEMO_TODAY,
      type: 'Deposit',
      methodId: result.methodId,
      status: result.ok ? 'Completed' : 'Failed',
      amountCents: result.amountCents,
    };
    setTransactions((prev) => [tx, ...prev]);
    // Failed deposits never touch the balance.
    if (result.ok) {
      setAvailableCents((c) => c + result.amountCents);
      setSummary((s) => ({
        ...s,
        depositsCents: s.depositsCents + result.amountCents,
        depositsCount: s.depositsCount + 1,
      }));
    }
  }

  function closeModal() {
    setModalOpen(false);
    addFundsBtn.current?.focus();
  }

  function contactSupport(reference: string) {
    // TODO: open an in-app ticket via the client's ticketing system.
    closeModal();
    showToast(`Support ticket opened with reference ${reference} attached.`);
  }

  function exportCsv() {
    const header = ['Date', 'Type', 'Method', 'Reference', 'Status', 'Amount (USD)'];
    const lines = visible.map((t) => {
      const sign = t.type === 'Deposit' ? '' : '-';
      return [t.date, t.type, methodById(t.methodId).longLabel, t.id, t.status, `${sign}${(t.amountCents / 100).toFixed(2)}`];
    });
    const csv = [header, ...lines].map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `transactions-${DEMO_TODAY}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const linkedLabel = paymentMethods.map((m) => m.label).join(', ');

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

      <main className="main">
        <header className="page-header">
          <div>
            <h1>Overview</h1>
            <span className="muted">Welcome back, {CLIENT_NAME}</span>
          </div>
          <div className="header-actions">
            {IS_DEMO && <span className="demo-tag">Demo data</span>}
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
                  {CLIENT_INITIALS}
                </span>
                Account
              </button>
              {menuOpen && (
                <div className="menu" role="menu">
                  <button role="menuitem" onClick={() => setMenuOpen(false)}>
                    Profile
                  </button>
                  <button role="menuitem" onClick={onSignOut}>
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <section className="balance" aria-label="Balance">
          <div>
            <span className="balance-label">Available balance · USD</span>
            <div className="balance-amount num">
              <span className="whole">{whole}</span>
              <span className="cents">{cents}</span>
            </div>
            <div className="balance-meta num">
              <span>
                Pending <strong>{formatUSD(pendingCents)}</strong>
              </span>
              <span>
                Total <strong>{formatUSD(totalCents)}</strong>
              </span>
              <span>Updated {initialBalance.updatedMinutesAgo} min ago</span>
            </div>
          </div>
          <div className="balance-actions">
            <button ref={addFundsBtn} className="btn btn-white" onClick={() => setModalOpen(true)}>
              <PlusIcon />
              Add funds
            </button>
            <button className="btn btn-outline-dark" onClick={() => showToast('Withdrawals are not available in this demo yet.')}>
              <ArrowUpIcon />
              Withdraw
            </button>
          </div>
        </section>

        <section className="summary" aria-label="Summary">
          <div className="stat">
            <span className="stat-label">Deposits this month</span>
            <span className="stat-value num">{formatUSD(summary.depositsCents)}</span>
            <span className="stat-detail stat-detail--success">{summary.depositsCount} completed</span>
          </div>
          <div className="stat">
            <span className="stat-label">Withdrawals this month</span>
            <span className="stat-value num">{formatUSD(summary.withdrawalsCents)}</span>
            <span className="stat-detail">{summary.withdrawalsCount} completed</span>
          </div>
          <div className="stat">
            <span className="stat-label">Pending transactions</span>
            <span className="stat-value num">{summary.pendingCount}</span>
            <span className="stat-detail stat-detail--warning">Awaiting confirmation</span>
          </div>
          <div className="stat">
            <span className="stat-label">Linked accounts</span>
            <span className="stat-value num">{paymentMethods.length}</span>
            <span className="stat-detail">{linkedLabel}</span>
          </div>
        </section>

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
              <button className="btn btn-secondary" onClick={exportCsv}>
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
                            <small>{methodById(t.methodId).longLabel}</small>
                          </div>
                        </div>
                      </td>
                      <td className="tx-ref">{t.id}</td>
                      <td>
                        <span className={`pill pill--${t.status.toLowerCase()}`}>{t.status}</span>
                      </td>
                      <td className={`right tx-amount ${amountClass}`}>
                        {failed && <span className="sr-only">Failed, not counted: </span>}
                        {signedUSD(t.amountCents, isIn ? '+' : '−')}
                      </td>
                    </tr>
                  );
                })}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={5} className="empty">
                      No transactions match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="panel-foot">
            <span>
              Showing {visible.length} of {TOTAL_TX_COUNT + (transactions.length - initialTransactions.length)}
            </span>
            <a href="#transactions">View all transactions</a>
          </div>
        </section>
      </main>

      {modalOpen && (
        <AddFundsModal
          nextReference={nextReference}
          onClose={closeModal}
          onCompleted={handleDeposit}
          onContactSupport={contactSupport}
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
