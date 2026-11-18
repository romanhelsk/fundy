import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../../api';
import { formatUSD } from '../../lib/format';
import type { ClientListItem, User } from '../../types';
import { FormError } from '../AuthLayout';
import { PlusIcon } from '../Icons';
import { Modal } from '../Modal';
import { TemporaryPasswordModal } from './TemporaryPassword';

interface Props {
  onOpen: (id: number) => void;
  onSessionExpired: () => void;
}

export function AdminClients({ onOpen, onSessionExpired }: Props) {
  const [query, setQuery] = useState('');
  const [clients, setClients] = useState<ClientListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(
    async (q: string) => {
      try {
        setClients((await api.admin.clients(q)).users);
        setError(null);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return onSessionExpired();
        setError(err instanceof ApiError ? err.message : 'Could not load clients.');
      }
    },
    [onSessionExpired],
  );

  // Debounced search.
  useEffect(() => {
    const t = window.setTimeout(() => load(query), 250);
    return () => window.clearTimeout(t);
  }, [query, load]);

  return (
    <>
      <section className="panel" aria-labelledby="clients-heading">
        <div className="panel-head">
          <h2 id="clients-heading">All clients</h2>
          <div className="toolbar">
            <label>
              <span className="sr-only">Search clients</span>
              <input
                className="input"
                type="search"
                placeholder="Search name or email"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <PlusIcon size={16} />
              New client
            </button>
          </div>
        </div>

        {error && (
          <p className="empty" role="alert">
            {error}
          </p>
        )}

        <div className="table-scroll">
          <table className="tx-table">
            <thead>
              <tr>
                <th scope="col">Client</th>
                <th scope="col">Linked accounts</th>
                <th scope="col" className="right">
                  Available
                </th>
                <th scope="col" className="right">
                  Pending
                </th>
                <th scope="col">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {clients?.map((c) => (
                <tr key={c.id}>
                  <td>
                    <strong>{c.name}</strong>
                    {c.mustChangePassword && <span className="pill pill--pending pill--inline">Awaiting first sign-in</span>}
                    <small className="block muted">{c.email}</small>
                  </td>
                  <td className="muted">{c.methodCount}</td>
                  <td className="right tx-amount">{formatUSD(c.balance.availableCents)}</td>
                  <td className="right tx-amount muted">{formatUSD(c.balance.pendingCents)}</td>
                  <td className="right">
                    <button className="btn btn-secondary btn-sm" onClick={() => onOpen(c.id)}>
                      Manage<span className="sr-only"> {c.name}</span>
                    </button>
                  </td>
                </tr>
              ))}
              {clients && clients.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty">
                    {query ? 'No clients match this search.' : 'No clients yet. Create the first one.'}
                  </td>
                </tr>
              )}
              {!clients && !error && (
                <tr>
                  <td colSpan={5} className="empty">
                    Loading clients…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {creating && (
        <CreateClientModal
          onClose={() => setCreating(false)}
          onCreated={() => load(query)}
          onOpen={onOpen}
          onSessionExpired={onSessionExpired}
        />
      )}
    </>
  );
}

function CreateClientModal({
  onClose,
  onCreated,
  onOpen,
  onSessionExpired,
}: {
  onClose: () => void;
  onCreated: () => void;
  onOpen: (id: number) => void;
  onSessionExpired: () => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ user: User; temporaryPassword: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Enter the client's full name.");
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError('Enter a valid email address.');
    setError(null);
    setBusy(true);
    try {
      setCreated(await api.admin.createClient(name.trim(), email));
      onCreated();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return onSessionExpired();
      setError(err instanceof ApiError ? err.message : 'Could not create the client.');
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <TemporaryPasswordModal
        title="Client created"
        user={created.user}
        temporaryPassword={created.temporaryPassword}
        onClose={onClose}
        primary={{ label: 'Open client', onClick: () => onOpen(created.user.id) }}
      />
    );
  }

  return (
    <Modal title="New client" description="They'll sign in with this email and a temporary password." onClose={onClose} locked={busy}>
      <form onSubmit={submit} noValidate className="form-stack">
        <label className="field">
          Full name
          <input className="input" data-autofocus value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          Email
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <FormError id="create-error" message={error} />
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Creating…' : 'Create client'}
        </button>
      </form>
    </Modal>
  );
}
