import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Candle, Instrument, PricingContext, TradeRecord } from '../core/types';
import { INSTRUMENTS, customInstrument, findInstrument } from '../core/instruments';
import { parseCandleCsv } from '../core/csv';
import { encryptStorage, openStorage, type DatasetMeta, type SessionRecord, type Settings, type Storage } from '../store/db';
import { connectCloud, mergeRecords, type Cipher, type CloudStatus, type CloudStore } from '../store/cloud';
import { packSealed, seal, unpackSealed, unseal, type ProfileMeta } from '../security/vault';
import { setHideAmounts } from '../lib/format';
import { DEFAULT_SETTINGS, SAMPLE_DATASET, withDefaults } from './defaults';

export { DEFAULT_SETTINGS, SAMPLE_DATASET };

export type Page = 'dashboard' | 'markets' | 'backtest' | 'journal' | 'data' | 'settings';

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'success' | 'error';
}

export interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel: string;
  danger?: boolean;
}

export interface ConfirmState extends ConfirmOptions {
  resolve(ok: boolean): void;
}

/** Who is signed in. Guest data is plain; an account's data is sealed with its key. */
export interface AccountSession {
  kind: 'guest' | 'account';
  profile?: ProfileMeta;
  key?: CryptoKey;
  dbName: string;
  cloudScope: string;
  /** Leave the app and show the login screen (data is dropped from memory). */
  lock(reason?: 'manual' | 'idle'): void;
}

export function cipherFor(key: CryptoKey): Cipher {
  return {
    seal: async (v) => packSealed(await seal(key, v)),
    open: async <T,>(t: string) => unseal<T>(key, unpackSealed(t)),
  };
}

interface AppValue {
  ready: boolean;
  storageMode: Storage['mode'];
  settings: Settings;
  updateSettings(patch: Partial<Settings>): void;
  pricing: PricingContext;
  instruments: Instrument[];
  instrumentFor(symbol: string): Instrument;
  trades: TradeRecord[];
  saveTrades(trades: TradeRecord[]): Promise<void>;
  deleteTrades(ids: string[]): Promise<void>;
  sessions: SessionRecord[];
  saveSession(s: SessionRecord): Promise<void>;
  deleteSession(id: string): Promise<void>;
  datasets: DatasetMeta[];
  loadCandles(id: string): Promise<Candle[]>;
  addDataset(meta: DatasetMeta, candles: Candle[]): Promise<void>;
  deleteDataset(id: string): Promise<void>;
  page: Page;
  go(page: Page, param?: string): void;
  param: string | undefined;
  toasts: Toast[];
  toast(message: string, tone?: Toast['tone']): void;
  dismissToast(id: number): void;
  confirm(opts: ConfirmOptions): Promise<boolean>;
  confirmState: ConfirmState | null;
  cloudStatus: CloudStatus;
  account: AccountSession;
  exportBackup(): Promise<string>;
  importBackup(json: string): Promise<{ trades: number; sessions: number }>;
  clearAll(): Promise<void>;
}

const Ctx = createContext<AppValue | null>(null);

export function useApp(): AppValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}

// Routes are plain "#name" or "#name-param" hashes: some hosts only pass that form through,
// and reserve "#settings", so the settings page lives at "#preferences".
const HASH_OF: Record<Page, string> = { dashboard: 'dashboard', markets: 'markets', backtest: 'backtest', journal: 'journal', data: 'data', settings: 'preferences' };

function readHash(): { page: Page; param?: string } {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const dash = raw.indexOf('-');
  const name = dash >= 0 ? raw.slice(0, dash) : raw;
  const param = dash >= 0 ? raw.slice(dash + 1) : undefined;
  const page = (Object.keys(HASH_OF) as Page[]).find((p) => HASH_OF[p] === name) ?? 'dashboard';
  return { page, param: param || undefined };
}

export function AppProvider({ children, account }: { children: ReactNode; account: AccountSession }) {
  const storageRef = useRef<Storage | null>(null);
  const candleCache = useRef(new Map<string, Candle[]>());
  const [ready, setReady] = useState(false);
  const [storageMode, setStorageMode] = useState<Storage['mode']>('indexeddb');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [userDatasets, setUserDatasets] = useState<DatasetMeta[]>([]);
  const [route, setRoute] = useState(readHash);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [cloudStatus, setCloudStatus] = useState<CloudStatus>('off');
  const cloudRef = useRef<CloudStore | null>(null);
  const tradesRef = useRef<TradeRecord[]>([]);
  const sessionsRef = useRef<SessionRecord[]>([]);
  const settingsRef = useRef<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    let alive = true;
    (async () => {
      const raw = await openStorage(account.dbName);
      const st = account.key ? encryptStorage(raw, account.key) : raw;
      if (!alive) return;
      storageRef.current = st;
      setStorageMode(st.mode);
      const [t, s, d, saved] = await Promise.all([
        st.getAll<TradeRecord>('trades'),
        st.getAll<SessionRecord>('sessions'),
        st.getAll<DatasetMeta>('datasets'),
        st.getKV<Partial<Settings>>('settings'),
      ]);
      if (!alive) return;
      const sortedSessions = s.sort((a, b) => b.updatedAt - a.updatedAt);
      const loadedSettings = saved ? withDefaults(saved) : settingsRef.current;
      // Keep the refs in step right away: the cloud merge below can run before React re-renders.
      tradesRef.current = t;
      sessionsRef.current = sortedSessions;
      settingsRef.current = loadedSettings;
      setTrades(t);
      setSessions(sortedSessions);
      setUserDatasets(d.sort((a, b) => b.createdAt - a.createdAt));
      if (saved) setSettings(loadedSettings);
      setReady(true);

      // When running as a Claude artifact, mirror the journal to the viewer's private cloud store
      // (sealed end to end for password-protected accounts).
      const cloud = await connectCloud(account.cloudScope, account.key ? cipherFor(account.key) : undefined);
      if (!alive || !cloud) return;
      setCloudStatus('connecting');
      try {
        const remote = await cloud.load();
        if (!alive) return;
        const localTrades = tradesRef.current;
        const localSessions = sessionsRef.current;
        const trades2 = mergeRecords(localTrades, remote.trades, remote.tradeTombs);
        const sessions2 = mergeRecords(localSessions, remote.sessions, remote.sessionTombs).sort((a, b) => b.updatedAt - a.updatedAt);
        const settings2 = remote.settings ? withDefaults(remote.settings) : settingsRef.current;
        const keepT = new Set(trades2.map((x) => x.id));
        const keepS = new Set(sessions2.map((x) => x.id));
        await st.putMany('trades', trades2);
        await st.removeMany('trades', localTrades.filter((x) => !keepT.has(x.id)).map((x) => x.id));
        await st.putMany('sessions', sessions2);
        await st.removeMany('sessions', localSessions.filter((x) => !keepS.has(x.id)).map((x) => x.id));
        await st.putKV('settings', settings2);
        cloud.onStatus = (status, message) => {
          setCloudStatus(status);
          if (message) toast(message, status === 'error' ? 'error' : 'info');
        };
        cloudRef.current = cloud;
        tradesRef.current = trades2;
        sessionsRef.current = sessions2;
        settingsRef.current = settings2;
        setTrades(trades2);
        setSessions(sessions2);
        setSettings(settings2);
        cloud.syncTrades(trades2);
        cloud.syncSessions(sessions2);
        cloud.syncSettings(settings2);
        setCloudStatus(cloud.status);
      } catch {
        if (alive) setCloudStatus('error');
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Keep refs current and mirror every change to the cloud copy (a no-op outside an artifact host).
  useEffect(() => {
    tradesRef.current = trades;
    cloudRef.current?.syncTrades(trades);
  }, [trades]);
  useEffect(() => {
    sessionsRef.current = sessions;
    cloudRef.current?.syncSessions(sessions);
  }, [sessions]);
  useEffect(() => {
    settingsRef.current = settings;
    cloudRef.current?.syncSettings(settings);
  }, [settings]);

  // Privacy: mask money everywhere while rendering this tree.
  setHideAmounts(settings.hideAmounts);

  // Privacy: lock a password-protected account after a period without input.
  const lockRef = useRef(account.lock);
  lockRef.current = account.lock;
  useEffect(() => {
    if (account.kind !== 'account' || !settings.autoLockMin) return;
    let last = Date.now();
    const bump = () => {
      last = Date.now();
    };
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;
    for (const e of events) window.addEventListener(e, bump, { passive: true });
    const id = setInterval(() => {
      if (Date.now() - last > settings.autoLockMin * 60_000) lockRef.current('idle');
    }, 5000);
    return () => {
      for (const e of events) window.removeEventListener(e, bump);
      clearInterval(id);
    };
  }, [account.kind, settings.autoLockMin]);

  useEffect(() => {
    const onHash = () => setRoute(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = useCallback((page: Page, param?: string) => {
    const hash = `#${HASH_OF[page]}${param ? `-${param}` : ''}`;
    if (window.location.hash !== hash) window.location.hash = hash;
    setRoute({ page, param });
    window.scrollTo({ top: 0 });
  }, []);

  const toast = useCallback((message: string, tone: Toast['tone'] = 'info') => {
    const id = ++toastId.current;
    setToasts((ts) => [...ts.slice(-2), { id, message, tone }]);
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), tone === 'error' ? 6000 : 3500);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) =>
        setConfirmState({
          ...opts,
          resolve: (ok) => {
            setConfirmState(null);
            resolve(ok);
          },
        }),
      ),
    [],
  );

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      storageRef.current?.putKV('settings', next);
      return next;
    });
  }, []);

  const instruments = useMemo(() => {
    const overrides = new Map(settings.instrumentOverrides.map((i) => [i.symbol, i]));
    const merged = INSTRUMENTS.map((i) => overrides.get(i.symbol) ?? i);
    for (const o of settings.instrumentOverrides) if (!INSTRUMENTS.some((i) => i.symbol === o.symbol)) merged.push(o);
    return merged;
  }, [settings.instrumentOverrides]);

  const instrumentFor = useCallback(
    (symbol: string) => findInstrument(symbol, instruments) ?? customInstrument(symbol),
    [instruments],
  );

  const pricing = useMemo<PricingContext>(
    () => ({ accountCurrency: settings.accountCurrency, usdValue: settings.usdValue }),
    [settings.accountCurrency, settings.usdValue],
  );

  const saveTrades = useCallback(async (list: TradeRecord[]) => {
    if (!list.length) return;
    await storageRef.current?.putMany('trades', list);
    const byId = new Map(tradesRef.current.map((t) => [t.id, t]));
    for (const t of list) byId.set(t.id, t);
    tradesRef.current = [...byId.values()];
    setTrades(tradesRef.current);
  }, []);

  const deleteTrades = useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    await storageRef.current?.removeMany('trades', ids);
    const set = new Set(ids);
    tradesRef.current = tradesRef.current.filter((t) => !set.has(t.id));
    setTrades(tradesRef.current);
  }, []);

  const saveSession = useCallback(async (s: SessionRecord) => {
    await storageRef.current?.put('sessions', s);
    sessionsRef.current = [s, ...sessionsRef.current.filter((x) => x.id !== s.id)].sort((a, b) => b.updatedAt - a.updatedAt);
    setSessions(sessionsRef.current);
  }, []);

  const deleteSession = useCallback(async (id: string) => {
    await storageRef.current?.remove('sessions', id);
    sessionsRef.current = sessionsRef.current.filter((x) => x.id !== id);
    setSessions(sessionsRef.current);
  }, []);

  const datasets = useMemo(() => [...userDatasets, SAMPLE_DATASET], [userDatasets]);

  const loadCandles = useCallback(async (id: string) => {
    const cached = candleCache.current.get(id);
    if (cached) return cached;
    let candles: Candle[] | undefined;
    if (id === SAMPLE_DATASET.id) {
      const mod = await import('../sample/EURUSD_H1_2017-2018.csv?raw');
      candles = parseCandleCsv(mod.default).candles;
    } else {
      candles = await storageRef.current?.getCandles(id);
    }
    if (!candles?.length) throw new Error('This dataset is no longer available. Import it again on the Data page.');
    candleCache.current.set(id, candles);
    return candles;
  }, []);

  const addDataset = useCallback(async (meta: DatasetMeta, candles: Candle[]) => {
    await storageRef.current?.putCandles(meta.id, candles);
    await storageRef.current?.put('datasets', meta);
    candleCache.current.set(meta.id, candles);
    setUserDatasets((prev) => [meta, ...prev.filter((d) => d.id !== meta.id)]);
  }, []);

  const deleteDataset = useCallback(async (id: string) => {
    await storageRef.current?.remove('datasets', id);
    await storageRef.current?.removeCandles(id);
    candleCache.current.delete(id);
    setUserDatasets((prev) => prev.filter((d) => d.id !== id));
  }, []);

  const exportBackup = useCallback(async () => {
    return JSON.stringify({ app: 'edgelab', version: 1, exportedAt: new Date().toISOString(), settings, trades, sessions }, null, 1);
  }, [settings, trades, sessions]);

  const importBackup = useCallback(
    async (json: string) => {
      const data = JSON.parse(json);
      if (data?.app !== 'edgelab') throw new Error('This is not an EdgeLab backup file.');
      const t: TradeRecord[] = Array.isArray(data.trades) ? data.trades : [];
      const s: SessionRecord[] = Array.isArray(data.sessions) ? data.sessions : [];
      await saveTrades(t);
      for (const x of s) await storageRef.current?.put('sessions', x);
      setSessions((prev) => {
        const byId = new Map(prev.map((x) => [x.id, x]));
        for (const x of s) byId.set(x.id, x);
        return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
      });
      if (data.settings) updateSettings({ ...data.settings });
      return { trades: t.length, sessions: s.length };
    },
    [saveTrades, updateSettings],
  );

  const clearAll = useCallback(async () => {
    const st = storageRef.current;
    if (st) {
      for (const d of userDatasets) await st.removeCandles(d.id);
      await Promise.all([st.clear('trades'), st.clear('sessions'), st.clear('datasets')]);
      await st.putKV('settings', DEFAULT_SETTINGS);
    }
    candleCache.current.clear();
    setTrades([]);
    setSessions([]);
    setUserDatasets([]);
    setSettings(DEFAULT_SETTINGS);
  }, [userDatasets]);

  const value: AppValue = {
    ready,
    storageMode,
    settings,
    updateSettings,
    pricing,
    instruments,
    instrumentFor,
    trades,
    saveTrades,
    deleteTrades,
    sessions,
    saveSession,
    deleteSession,
    datasets,
    loadCandles,
    addDataset,
    deleteDataset,
    page: route.page,
    param: route.param,
    go,
    toasts,
    toast,
    dismissToast,
    confirm,
    confirmState,
    cloudStatus,
    account,
    exportBackup,
    importBackup,
    clearAll,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
