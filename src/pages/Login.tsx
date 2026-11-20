import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { createProfile, passwordStrength, unlockProfile, type ProfileMeta } from '../security/vault';
import { accountDbName, accountScope, accounts, clearFailures, cloudOnlyAccounts, cooldownLeft, GUEST_DB, lastAccount, recordFailure, rememberLastAccount } from '../security/accounts';
import { encryptStorage, openStorage } from '../store/db';
import { connectCloud } from '../store/cloud';
import type { AccountSession } from '../state/AppContext';
import { SessionRibbon } from '../components/SessionRibbon';
import { browserTimeZone } from '../core/time';
import { plural } from '../lib/format';
import { ThemeToggle } from '../components/ThemeToggle';

type Session = Omit<AccountSession, 'lock'>;

/** Copy everything from the unencrypted guest space into a new account, then wipe the guest copy. */
async function moveGuestData(key: CryptoKey, accountId: string): Promise<void> {
  const guest = await openStorage(GUEST_DB);
  const target = encryptStorage(await openStorage(accountDbName(accountId)), key);
  const [trades, sessions, datasets, settings] = await Promise.all([
    guest.getAll<{ id: string }>('trades'),
    guest.getAll<{ id: string }>('sessions'),
    guest.getAll<{ id: string }>('datasets'),
    guest.getKV<object>('settings'),
  ]);
  await target.putMany('trades', trades);
  await target.putMany('sessions', sessions);
  for (const d of datasets) {
    const candles = await guest.getCandles(d.id);
    if (candles) await target.putCandles(d.id, candles);
    await target.put('datasets', d);
  }
  if (settings) await target.putKV('settings', settings);
  for (const d of datasets) await guest.removeCandles(d.id);
  await Promise.all([guest.clear('trades'), guest.clear('sessions'), guest.clear('datasets')]);
  await guest.putKV('settings', {});
  const cloud = await connectCloud('edgelab');
  if (cloud) {
    try {
      await cloud.load();
      cloud.clearAll();
      await cloud.idle();
    } catch {
      /* the guest copy online can be removed later from guest Settings */
    }
  }
}

function Candles() {
  // A quiet illustration: the replay idea, past candles solid and future ones hidden.
  const bars = [
    [8, 30, 14, 40, 1], [26, 22, 10, 34, 1], [44, 26, 18, 44, 0], [62, 14, 8, 30, 1], [80, 20, 12, 38, 0],
    [98, 10, 4, 24, 1], [116, 16, 8, 30, 1], [134, 6, 0, 20, 1],
  ];
  return (
    <svg viewBox="0 0 220 60" className="h-[60px] w-[220px]" aria-hidden>
      {bars.map(([x, y, wickTop, h, up], i) => (
        <g key={i} opacity={i < 6 ? 1 : 0.18}>
          <line x1={x + 4} x2={x + 4} y1={wickTop} y2={y + h + 6} stroke={up ? 'var(--color-profit)' : 'var(--color-loss)'} strokeWidth="1.5" />
          <rect x={x} y={y} width="8" height={h - y > 4 ? h - y : 6} rx="1.5" fill={up ? 'var(--color-profit)' : 'var(--color-loss)'} />
        </g>
      ))}
      <line x1="122" x2="122" y1="0" y2="60" stroke="var(--color-brass-fg)" strokeWidth="1.5" strokeDasharray="3 3" />
      <rect x="150" y="18" width="64" height="24" rx="5" fill="none" stroke="var(--color-ink-600)" strokeDasharray="3 3" />
      <text x="182" y="34" textAnchor="middle" fontSize="9" fill="var(--color-fg-3)">
        hidden
      </text>
    </svg>
  );
}

export function LoginScreen({ onEnter, note }: { onEnter(s: Session): void; note?: string | null }) {
  const [list, setList] = useState<ProfileMeta[] | null>(null);
  const [cloudList, setCloudList] = useState<ProfileMeta[]>([]);
  const [mode, setMode] = useState<'signin' | 'create'>('signin');
  const [selected, setSelected] = useState<string>('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [ack, setAck] = useState(false);
  const [moveGuest, setMoveGuest] = useState(true);
  const [guestCount, setGuestCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      const local = await accounts.list();
      if (!alive) return;
      setList(local);
      const last = lastAccount();
      setSelected(local.find((a) => a.id === last)?.id ?? local[0]?.id ?? '');
      if (!local.length) setMode('create');
      try {
        const guest = await openStorage(GUEST_DB);
        const [t, s] = await Promise.all([guest.getAll('trades'), guest.getAll('sessions')]);
        if (alive) setGuestCount(t.length + s.length);
      } catch {
        /* no guest data */
      }
      const remote = await cloudOnlyAccounts();
      if (!alive || !remote.length) return;
      setCloudList(remote);
      if (!local.length) {
        setSelected(remote[0].id);
        setMode('signin');
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const all = useMemo(() => [...(list ?? []), ...cloudList], [list, cloudList]);
  const wait = selected ? cooldownLeft(selected) : 0;
  useEffect(() => {
    if (!wait) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [wait]);

  const strength = passwordStrength(newPw);

  const enterAccount = (meta: ProfileMeta, key: CryptoKey) => {
    rememberLastAccount(meta.id);
    onEnter({ kind: 'account', profile: meta, key, dbName: accountDbName(meta.id), cloudScope: accountScope(meta.id) });
  };

  const signIn = async (e: FormEvent) => {
    e.preventDefault();
    const meta = all.find((a) => a.id === selected);
    if (!meta) return;
    if (cooldownLeft(meta.id)) return;
    if (!password) return setError('Enter your password.');
    setBusy(true);
    setError(null);
    try {
      const key = await unlockProfile(meta, password);
      if (!key) {
        const w = recordFailure(meta.id);
        setError(w ? `Wrong password. Too many attempts, try again in ${w} seconds.` : 'Wrong password.');
        return;
      }
      clearFailures(meta.id);
      if (cloudList.some((c) => c.id === meta.id)) await accounts.save(meta);
      setPassword('');
      enterAccount(meta, key);
    } finally {
      setBusy(false);
    }
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setError('Give the account a name.');
    if (n.length > 40) return setError('Use a name of 40 characters or fewer.');
    if (newPw.length < 8) return setError('Use a password of at least 8 characters.');
    if (strength.score < 2) return setError('Choose a stronger password: longer, with a mix of letters, numbers and symbols.');
    if (newPw !== confirmPw) return setError("The two passwords don't match.");
    if (!ack) return setError('Tick the box to confirm you understand the password cannot be reset.');
    setBusy(true);
    setError(null);
    try {
      const { meta, key } = await createProfile(n, newPw);
      await accounts.save(meta);
      if (moveGuest && guestCount > 0) await moveGuestData(key, meta.id);
      setNewPw('');
      setConfirmPw('');
      enterAccount(meta, key);
    } catch (err) {
      setError(`Could not create the account: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const guest = () => {
    rememberLastAccount(null);
    onEnter({ kind: 'guest', dbName: GUEST_DB, cloudScope: 'edgelab' });
  };

  return (
    <div className="relative min-h-screen bg-ink-950">
      <ThemeToggle className="absolute right-4 top-4 z-10 sm:right-6" />
      <div className="mx-auto grid min-h-screen max-w-[1100px] items-center gap-10 px-5 py-10 lg:grid-cols-[1.1fr_minmax(0,420px)]">
        <section className="max-w-[52ch]">
          <div className="flex items-center gap-3">
            <svg width="40" height="40" viewBox="0 0 32 32" aria-hidden>
              <rect x="6" y="10" width="6" height="12" rx="1.5" fill="var(--color-loss)" />
              <path d="M9 6v4M9 22v4" stroke="var(--color-loss)" strokeWidth="1.8" strokeLinecap="round" />
              <rect x="19" y="7" width="6" height="15" rx="1.5" fill="var(--color-profit)" />
              <path d="M22 3v4M22 22v6" stroke="var(--color-profit)" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <span className="type-display text-[30px]">EdgeLab</span>
          </div>
          <h1 className="type-display mt-8 text-[40px] leading-[1.05] sm:text-[52px]">Test the setup before you trade it.</h1>
          <p className="mt-4 text-[16px] text-fg-2">Replay any pair candle by candle, journal every trade, and see in R multiples where your edge really is.</p>
          <div className="mt-8 hidden sm:block">
            <Candles />
          </div>
          <div className="mt-8 hidden lg:block">
            <SessionRibbon tz={browserTimeZone()} />
          </div>
        </section>

        <section className="panel p-6" aria-label={mode === 'signin' ? 'Sign in' : 'Create an account'}>
          {note && <p className="mb-4 rounded-[var(--radius-ctl)] border border-brass/40 bg-brass/10 px-3 py-2 text-[13px]">{note}</p>}
          {list === null ? (
            <p className="text-fg-3">Loading accounts…</p>
          ) : mode === 'signin' && all.length > 0 ? (
            <form onSubmit={signIn} className="space-y-4">
              <h2 className="text-[20px] font-semibold">Sign in</h2>
              <label className="block">
                <span className="mb-1 block text-[13px] text-fg-2">Account</span>
                <select className="field" value={selected} onChange={(e) => { setSelected(e.target.value); setError(null); }}>
                  {all.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                      {cloudList.some((c) => c.id === a.id) ? ' (from your other device)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[13px] text-fg-2">Password</span>
                <input className="field" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
              </label>
              {error && <p role="alert" className="text-[13px] text-loss-fg">{error}</p>}
              {wait > 0 && !error && <p className="text-[13px] text-loss-fg">Too many attempts. Try again in {wait} seconds.</p>}
              <button type="submit" disabled={busy || wait > 0} className="h-11 w-full rounded-[var(--radius-ctl)] bg-brass font-semibold text-brass-ink transition hover:brightness-110 disabled:opacity-50">
                {busy ? 'Unlocking…' : 'Unlock'}
              </button>
              <div className="flex flex-wrap justify-between gap-2 text-[13px]">
                <button type="button" className="text-brass-fg hover:underline" onClick={() => { setMode('create'); setError(null); }}>
                  Create an account
                </button>
                <button type="button" className="text-fg-2 hover:text-fg" onClick={guest}>
                  Continue as guest
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={create} className="space-y-4">
              <h2 className="text-[20px] font-semibold">Create an account</h2>
              <label className="block">
                <span className="mb-1 block text-[13px] text-fg-2">Account name</span>
                <input className="field" autoComplete="username" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              </label>
              <div>
              <label className="block">
                <span className="mb-1 block text-[13px] text-fg-2">Password</span>
                <input className="field" type="password" autoComplete="new-password" aria-describedby="pw-strength" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
              </label>
                <span id="pw-strength" className="mt-1.5 flex items-center gap-2" aria-live="polite">
                  <span className="flex h-1.5 flex-1 gap-1">
                    {[1, 2, 3, 4].map((i) => (
                      <span key={i} className="h-full flex-1 rounded-full" style={{ background: strength.score >= i ? (strength.score >= 3 ? 'var(--color-profit)' : strength.score === 2 ? 'var(--color-brass)' : 'var(--color-loss)') : 'var(--color-ink-700)' }} />
                    ))}
                  </span>
                  <span className="w-[86px] text-right text-[12px] text-fg-3">{newPw ? strength.label : ''}</span>
                </span>
              </div>
              <label className="block">
                <span className="mb-1 block text-[13px] text-fg-2">Confirm password</span>
                <input className="field" type="password" autoComplete="new-password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} />
              </label>
              <label className="flex items-start gap-2 text-[13px] text-fg-2">
                <input type="checkbox" className="mt-0.5" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                I understand my journal is encrypted with this password, and a forgotten password can't be reset.
              </label>
              {guestCount > 0 && (
                <label className="flex items-start gap-2 text-[13px] text-fg-2">
                  <input type="checkbox" className="mt-0.5" checked={moveGuest} onChange={(e) => setMoveGuest(e.target.checked)} />
                  Move my guest journal ({plural(guestCount, 'item')}) into this account and remove the unencrypted copy.
                </label>
              )}
              {error && <p role="alert" className="text-[13px] text-loss-fg">{error}</p>}
              <button type="submit" disabled={busy} className="h-11 w-full rounded-[var(--radius-ctl)] bg-brass font-semibold text-brass-ink transition hover:brightness-110 disabled:opacity-50">
                {busy ? 'Creating and encrypting…' : 'Create account'}
              </button>
              <div className="flex flex-wrap justify-between gap-2 text-[13px]">
                {all.length > 0 ? (
                  <button type="button" className="text-brass-fg hover:underline" onClick={() => { setMode('signin'); setError(null); }}>
                    Back to sign in
                  </button>
                ) : (
                  <span />
                )}
                <button type="button" className="text-fg-2 hover:text-fg" onClick={guest}>
                  Continue as guest
                </button>
              </div>
            </form>
          )}
          <p className="mt-6 border-t border-ink-700 pt-4 text-[12px] leading-relaxed text-fg-3">
            Accounts are encrypted on this device with AES-256 before anything is saved or synced. Your password is never stored or sent anywhere. Guest data is not encrypted.
          </p>
        </section>
      </div>
    </div>
  );
}
