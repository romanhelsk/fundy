import { useState } from 'react';
import { Dashboard } from './components/Dashboard';
import { Login } from './components/Login';

const SESSION_KEY = 'fundy.demoSession';

export function App() {
  const [signedIn, setSignedIn] = useState(
    () => localStorage.getItem(SESSION_KEY) === '1' || sessionStorage.getItem(SESSION_KEY) === '1',
  );

  function signIn(remember: boolean) {
    (remember ? localStorage : sessionStorage).setItem(SESSION_KEY, '1');
    setSignedIn(true);
  }

  function signOut() {
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
    setSignedIn(false);
  }

  return signedIn ? <Dashboard onSignOut={signOut} /> : <Login onSignIn={signIn} />;
}
