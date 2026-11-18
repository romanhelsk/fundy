import { useEffect, useState } from 'react';
import { api } from './api';
import { Dashboard } from './components/Dashboard';
import { Login } from './components/Login';
import { Signup } from './components/Signup';
import { Verify } from './components/Verify';
import type { MfaChallenge, User } from './types';

type View =
  | { name: 'loading' }
  | { name: 'login'; notice?: string | null }
  | { name: 'signup' }
  | { name: 'verify'; challenge: MfaChallenge }
  | { name: 'app'; user: User };

export function App() {
  const [view, setView] = useState<View>({ name: 'loading' });

  useEffect(() => {
    api
      .session()
      .then(({ user }) => setView({ name: 'app', user }))
      .catch(() => setView({ name: 'login' }));
  }, []);

  const toLogin = (notice?: string | null) => setView({ name: 'login', notice });
  const toVerify = (challenge: MfaChallenge) => setView({ name: 'verify', challenge });

  async function signOut() {
    await api.logout().catch(() => undefined);
    toLogin('You have been signed out.');
  }

  switch (view.name) {
    case 'loading':
      return <div className="boot" aria-busy="true" aria-label="Loading" />;
    case 'login':
      return <Login notice={view.notice} onChallenge={toVerify} onCreateAccount={() => setView({ name: 'signup' })} />;
    case 'signup':
      return <Signup onChallenge={toVerify} onSignIn={() => toLogin()} />;
    case 'verify':
      return (
        <Verify
          key={view.challenge.challengeId}
          challenge={view.challenge}
          onVerified={(user) => setView({ name: 'app', user })}
          onRestart={(msg) => toLogin(msg)}
        />
      );
    case 'app':
      return (
        <Dashboard
          user={view.user}
          onSignOut={signOut}
          onSessionExpired={() => toLogin('Your session has expired. Please sign in again.')}
        />
      );
  }
}
