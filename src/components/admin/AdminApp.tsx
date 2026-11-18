import { useCallback, useEffect, useState } from 'react';
import { BRAND_NAME } from '../../config';
import type { User } from '../../types';
import { LogoIcon, OverviewIcon } from '../Icons';
import { AdminClientDetail } from './AdminClientDetail';
import { AdminClients } from './AdminClients';

interface Props {
  user: User;
  onSignOut: () => void;
  onSessionExpired: () => void;
}

/** Admin routes live in the hash so reload and Back work: #/clients, #/clients/12 */
function parseRoute(hash: string): { clientId: number | null } {
  const m = hash.match(/^#\/clients\/(\d+)$/);
  return { clientId: m ? Number(m[1]) : null };
}

export function AdminApp({ user, onSignOut, onSessionExpired }: Props) {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onHash = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const openClient = useCallback((id: number) => {
    window.location.hash = `#/clients/${id}`;
  }, []);
  const backToList = useCallback(() => {
    window.location.hash = '#/clients';
  }, []);

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Admin">
        <div className="brand">
          <span className="brand-mark">
            <LogoIcon />
          </span>
          <span>{BRAND_NAME}</span>
        </div>
        <ul className="nav">
          <li>
            <a href="#/clients" aria-current="page">
              <OverviewIcon />
              Clients
            </a>
          </li>
        </ul>
        <div className="help-card">
          <strong>Admin console</strong>
          <span>Every change you make here is recorded in the client's activity log.</span>
        </div>
      </nav>

      <main className="main">
        <header className="page-header">
          <div>
            <h1>{route.clientId ? 'Client' : 'Clients'}</h1>
            <span className="muted">Signed in as {user.name}</span>
          </div>
          <div className="header-actions">
            <span className="demo-tag demo-tag--admin">Admin</span>
            <div className="menu-wrap">
              <button
                className="account-btn"
                aria-label="Account menu"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((o) => !o)}
              >
                <span className="avatar" aria-hidden="true">
                  {user.name.slice(0, 1).toUpperCase()}
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

        {route.clientId ? (
          <AdminClientDetail
            key={route.clientId}
            clientId={route.clientId}
            onBack={backToList}
            onSessionExpired={onSessionExpired}
          />
        ) : (
          <AdminClients onOpen={openClient} onSessionExpired={onSessionExpired} />
        )}
      </main>
    </div>
  );
}
