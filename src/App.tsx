import { useCallback, useState } from 'react';
import { AppProvider, useApp, type AccountSession } from './state/AppContext';
import { SessionRibbon } from './components/SessionRibbon';
import { ConfirmDialog, Toasts } from './components/ui';
import { Dashboard } from './pages/Dashboard';
import { MarketsPage } from './pages/Markets';
import { TerminalPage } from './terminal/Terminal';
import { Journal } from './pages/Journal';
import { DataPage } from './pages/Data';
import { SettingsPage } from './pages/Settings';
import { LoginScreen } from './pages/Login';
import { GUEST_DB, lastModeWasGuest } from './security/accounts';
import { AccountControls, NAV, Wordmark } from './components/AppChrome';

function Shell() {
  const { page, go, ready, settings, storageMode, cloudStatus } = useApp();
  // The chart is a full-screen workspace with its own toolbar, like a trading terminal.
  if (page === 'backtest' && ready)
    return (
      <>
        <TerminalPage />
        <Toasts />
        <ConfirmDialog />
      </>
    );
  return (
    <div className="min-h-screen">
      <header className="app-header sticky top-0 z-40 border-b border-ink-700 backdrop-blur">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5 sm:px-6">
          <button type="button" onClick={() => go('dashboard')} aria-label="EdgeLab home" className="rounded">
            <Wordmark />
          </button>
          <nav className="order-3 -mx-1 flex w-full gap-0.5 overflow-x-auto sm:order-none sm:w-auto" aria-label="Main">
            {NAV.map((n) => {
              const active = page === n.page;
              return (
                <button
                  key={n.page}
                  type="button"
                  onClick={() => go(n.page)}
                  aria-current={active ? 'page' : undefined}
                  className={`relative flex h-9 shrink-0 items-center gap-1.5 rounded-[var(--radius-ctl)] px-2 transition sm:px-2.5 ${active ? 'text-fg' : 'text-fg-2 hover:bg-ink-850 hover:text-fg'}`}
                >
                  <n.Icon size={17} className={active ? 'text-brass-fg' : 'opacity-80'} />
                  {n.label}
                  {active && <span className="absolute inset-x-2.5 -bottom-[11px] h-[2px] rounded-full bg-brass" />}
                </button>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-4">
            <div className="hidden xl:block">
              <SessionRibbon tz={settings.timezone} />
            </div>
            <AccountControls />
          </div>
        </div>
      </header>
      {storageMode === 'memory' && ready && cloudStatus !== 'synced' && cloudStatus !== 'connecting' && (
        <div className="border-b border-loss/40 bg-loss/10 px-6 py-2 text-center text-[13px]">
          Your browser is blocking storage here, so changes last only until you close this tab. Export a backup from Settings to keep them.
        </div>
      )}
      <main className={`mx-auto px-4 py-5 sm:px-6 ${page === 'markets' ? 'max-w-[1800px]' : 'max-w-[1400px]'}`}>
        {!ready ? (
          <p className="text-fg-3">Opening your journal…</p>
        ) : page === 'dashboard' ? (
          <Dashboard />
        ) : page === 'markets' ? (
          <MarketsPage />
        ) : page === 'journal' ? (
          <Journal />
        ) : page === 'data' ? (
          <DataPage />
        ) : (
          <SettingsPage />
        )}
      </main>
      <Toasts />
      <ConfirmDialog />
    </div>
  );
}

type Session = Omit<AccountSession, 'lock'>;

export default function App() {
  // Guests skip the sign-in screen on return visits; accounts always unlock with their password.
  const [session, setSession] = useState<Session | null>(() => (lastModeWasGuest() ? { kind: 'guest', dbName: GUEST_DB, cloudScope: 'edgelab' } : null));
  const [note, setNote] = useState<string | null>(null);
  const lock = useCallback((reason: 'manual' | 'idle' = 'manual') => {
    setSession(null);
    setNote(reason === 'idle' ? 'Locked after a period without activity. Unlock to continue where you left off.' : null);
  }, []);

  if (!session) {
    return (
      <LoginScreen
        note={note}
        onEnter={(s) => {
          setNote(null);
          setSession(s);
        }}
      />
    );
  }
  return (
    <AppProvider key={session.dbName} account={{ ...session, lock }}>
      <Shell />
    </AppProvider>
  );
}
