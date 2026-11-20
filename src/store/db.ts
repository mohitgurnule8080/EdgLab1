import { openDB, deleteDB, type IDBPDatabase } from 'idb';
import type { Candle, Instrument } from '../core/types';
import type { ReplayState } from '../core/replay';
import { seal, unseal, type Sealed } from '../security/vault';
import type { Drawing } from '../terminal/drawings';
import type { IndicatorConfig } from '../core/indicators';

/**
 * Local-first persistence. Everything lives in the browser's IndexedDB, so a trader's
 * journal never leaves their device. If IndexedDB is unavailable (private mode, sandboxed
 * frames) the app keeps working in memory and tells the user to export a backup.
 */

export interface DatasetMeta {
  id: string;
  name: string;
  symbol: string;
  tfSec: number;
  count: number;
  start: number;
  end: number;
  format: string;
  tzOffsetHours: number;
  createdAt: number;
  builtIn?: boolean;
  /** Present when the candles were downloaded from a market data provider and can be updated. */
  sync?: SyncSource;
}

export type ProviderId = 'binance' | 'twelvedata';

export interface SyncSource {
  provider: ProviderId;
  /** Symbol as the provider spells it: BTCUSDT on Binance, EUR/USD on Twelve Data. */
  remoteSymbol: string;
  lastSync: number;
}

export interface WatchItem {
  /** TradingView symbol, e.g. OANDA:XAUUSD */
  tv: string;
  label: string;
}

export interface SessionConfig {
  startingBalance: number;
  spreadPips: number;
  commissionPerLot: number;
  riskPct: number;
}

export interface SessionRecord {
  id: string;
  name: string;
  datasetId: string;
  symbol: string;
  displayTfSec: number;
  setup: string;
  config: SessionConfig;
  state: ReplayState;
  startIndex: number;
  /** Open time of the candle the replay has reached, for the sessions list. */
  cursorTime?: number;
  status: 'active' | 'finished';
  /** Chart drawings made during this replay. */
  drawings?: Drawing[];
  /** Plan and review notes for the session (journal). */
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Settings {
  accountCurrency: string;
  accountSize: number;
  timezone: string;
  defaultRiskPct: number;
  defaultCommission: number;
  usdValue: Record<string, number>;
  instrumentOverrides: Instrument[];
  /** Minutes of inactivity before a password-protected account locks; 0 = never. */
  autoLockMin: number;
  /** Mask money amounts everywhere (for screen recording and screenshots). */
  hideAmounts: boolean;
  apiKeys: { twelvedata?: string };
  watchlist: WatchItem[];
  /** Chart indicators shown in the terminal. */
  indicators?: IndicatorConfig;
  /** Drawings on the live (non-replay) chart, per symbol. */
  drawings?: Record<string, Drawing[]>;
  /** Last symbol, dataset and timeframe open in the terminal. */
  terminal?: { datasetId?: string; tfSec?: number };
}

type StoreName = 'trades' | 'sessions' | 'datasets';
type Row = { id: string };

export interface Storage {
  mode: 'indexeddb' | 'memory';
  encrypted?: boolean;
  getAll<T extends Row>(store: StoreName): Promise<T[]>;
  put<T extends Row>(store: StoreName, value: T): Promise<void>;
  putMany<T extends Row>(store: StoreName, values: T[]): Promise<void>;
  remove(store: StoreName, id: string): Promise<void>;
  removeMany(store: StoreName, ids: string[]): Promise<void>;
  clear(store: StoreName): Promise<void>;
  getCandles(id: string): Promise<Candle[] | undefined>;
  putCandles(id: string, candles: Candle[]): Promise<void>;
  removeCandles(id: string): Promise<void>;
  getKV<T>(key: string): Promise<T | undefined>;
  putKV<T>(key: string, value: T): Promise<void>;
}

// Candles are stored as one Float64Array per dataset: [time, o, h, l, c, v] * n.
function encodeCandles(candles: Candle[]): ArrayBuffer {
  const a = new Float64Array(candles.length * 6);
  candles.forEach((c, i) => {
    const j = i * 6;
    a[j] = c.time;
    a[j + 1] = c.open;
    a[j + 2] = c.high;
    a[j + 3] = c.low;
    a[j + 4] = c.close;
    a[j + 5] = c.volume;
  });
  return a.buffer;
}

function decodeCandles(buf: ArrayBuffer): Candle[] {
  const a = new Float64Array(buf);
  const out: Candle[] = new Array(a.length / 6);
  for (let i = 0; i < out.length; i++) {
    const j = i * 6;
    out[i] = { time: a[j], open: a[j + 1], high: a[j + 2], low: a[j + 3], close: a[j + 4], volume: a[j + 5] };
  }
  return out;
}

function memoryStorage(): Storage {
  const stores: Record<StoreName, Map<string, unknown>> = { trades: new Map(), sessions: new Map(), datasets: new Map() };
  const candles = new Map<string, Candle[]>();
  const kv = new Map<string, unknown>();
  return {
    mode: 'memory',
    async getAll<T>(s: StoreName) {
      return [...stores[s].values()] as T[];
    },
    async put(s, v) {
      stores[s].set(v.id, structuredClone(v));
    },
    async putMany(s, vs) {
      for (const v of vs) stores[s].set(v.id, structuredClone(v));
    },
    async remove(s, id) {
      stores[s].delete(id);
    },
    async removeMany(s, ids) {
      for (const id of ids) stores[s].delete(id);
    },
    async clear(s) {
      stores[s].clear();
    },
    async getCandles(id) {
      return candles.get(id);
    },
    async putCandles(id, c) {
      candles.set(id, c);
    },
    async removeCandles(id) {
      candles.delete(id);
    },
    async getKV<T>(key: string) {
      return kv.get(key) as T | undefined;
    },
    async putKV(key, value) {
      kv.set(key, structuredClone(value));
    },
  };
}

function idbStorage(db: IDBPDatabase): Storage {
  return {
    mode: 'indexeddb',
    async getAll<T>(s: StoreName) {
      return (await db.getAll(s)) as T[];
    },
    async put(s, v) {
      await db.put(s, v);
    },
    async putMany(s, vs) {
      const tx = db.transaction(s, 'readwrite');
      await Promise.all([...vs.map((v) => tx.store.put(v)), tx.done]);
    },
    async remove(s, id) {
      await db.delete(s, id);
    },
    async removeMany(s, ids) {
      const tx = db.transaction(s, 'readwrite');
      await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
    },
    async clear(s) {
      await db.clear(s);
    },
    async getCandles(id) {
      const row = (await db.get('candles', id)) as { id: string; data: ArrayBuffer } | undefined;
      return row ? decodeCandles(row.data) : undefined;
    },
    async putCandles(id, c) {
      await db.put('candles', { id, data: encodeCandles(c) });
    },
    async removeCandles(id) {
      await db.delete('candles', id);
    },
    async getKV<T>(key: string) {
      const row = (await db.get('kv', key)) as { id: string; value: T } | undefined;
      return row?.value;
    },
    async putKV(key, value) {
      await db.put('kv', { id: key, value });
    },
  };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * Seal journal records (trades, sessions, settings) with the account key before they reach
 * IndexedDB. Market data (datasets, candles) is public information and stays unencrypted.
 */
export function encryptStorage(base: Storage, key: CryptoKey): Storage {
  const isSealed = (v: unknown): v is Sealed => !!v && typeof (v as Sealed).ct === 'string' && typeof (v as Sealed).iv === 'string';
  const sealRow = async (v: Row) => ({ id: v.id, ...(await seal(key, v)) });
  const openRow = async (r: unknown) => (isSealed(r) ? unseal(key, r) : r);
  const plain = (s: StoreName) => s === 'datasets';
  return {
    ...base,
    encrypted: true,
    async getAll<T extends Row>(s: StoreName) {
      const rows = await base.getAll<Row>(s);
      return (plain(s) ? rows : await Promise.all(rows.map(openRow))) as T[];
    },
    async put(s, v) {
      if (plain(s)) await base.put(s, v);
      else await base.put<Row>(s, await sealRow(v));
    },
    async putMany(s, vs) {
      if (plain(s)) await base.putMany(s, vs);
      else await base.putMany<Row>(s, await Promise.all(vs.map(sealRow)));
    },
    async getKV<T>(k: string) {
      const v = await base.getKV<unknown>(k);
      return (isSealed(v) ? await unseal<T>(key, v) : v) as T | undefined;
    },
    async putKV(k, v) {
      await base.putKV(k, await seal(key, v));
    },
  };
}

export async function deleteDatabase(name: string): Promise<void> {
  try {
    await withTimeout(deleteDB(name), 4000);
  } catch {
    /* best effort */
  }
}

export async function openStorage(name = 'edgelab'): Promise<Storage> {
  try {
    if (typeof indexedDB === 'undefined') throw new Error('no indexedDB');
    const db = await withTimeout(
      openDB(name, 1, {
        upgrade(d) {
          for (const name of ['trades', 'sessions', 'datasets', 'candles', 'kv']) {
            if (!d.objectStoreNames.contains(name)) d.createObjectStore(name, { keyPath: 'id' });
          }
        },
      }),
      4000,
    );
    // Round-trip a write so a read-only or broken store is caught now, not on first save.
    await db.put('kv', { id: '__probe', value: Date.now() });
    try {
      await navigator.storage?.persist?.();
    } catch {
      /* optional */
    }
    return idbStorage(db);
  } catch {
    return memoryStorage();
  }
}
