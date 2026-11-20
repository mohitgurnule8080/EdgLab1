import type { Settings, DatasetMeta, WatchItem } from '../store/db';
import { DEFAULT_USD_VALUE } from '../core/instruments';
import { browserTimeZone } from '../core/time';

export const SAMPLE_DATASET: DatasetMeta = {
  id: 'sample-eurusd-h1',
  name: 'EURUSD H1 sample',
  symbol: 'EURUSD',
  tfSec: 3600,
  count: 5000,
  start: Date.parse('2017-04-19T09:00:00Z') / 1000,
  end: Date.parse('2018-02-07T15:00:00Z') / 1000,
  format: 'Built-in sample',
  tzOffsetHours: 0,
  createdAt: 0,
  builtIn: true,
};

export function withDefaults(saved: Partial<Settings>): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    usdValue: { ...DEFAULT_USD_VALUE, ...(saved.usdValue ?? {}) },
    instrumentOverrides: saved.instrumentOverrides ?? [],
    apiKeys: { ...(saved.apiKeys ?? {}) },
    watchlist: saved.watchlist?.length ? saved.watchlist : DEFAULT_WATCHLIST,
  };
}

/** The watchlist from the trader's own TradingView layout. */
export const DEFAULT_WATCHLIST: WatchItem[] = [
  { tv: 'BITSTAMP:BTCUSD', label: 'BTCUSD' },
  { tv: 'NASDAQ:NDX', label: 'NASDAQ' },
  { tv: 'OANDA:XAUUSD', label: 'XAUUSD' },
  { tv: 'TVC:USOIL', label: 'USOIL' },
  { tv: 'FX:GBPUSD', label: 'GBPUSD' },
  { tv: 'FX:EURUSD', label: 'EURUSD' },
  { tv: 'BINANCE:BTCUSDT', label: 'BTCUSDT' },
  { tv: 'COMEX:GC1!', label: 'GC1!' },
  { tv: 'CME_MINI:NQ1!', label: 'NQ1!' },
  { tv: 'NYMEX:CL1!', label: 'CL1!' },
];

export const DEFAULT_SETTINGS: Settings = {
  accountCurrency: 'USD',
  accountSize: 10_000,
  timezone: browserTimeZone(),
  defaultRiskPct: 1,
  defaultCommission: 0,
  usdValue: { ...DEFAULT_USD_VALUE },
  instrumentOverrides: [],
  autoLockMin: 15,
  hideAmounts: false,
  apiKeys: {},
  watchlist: DEFAULT_WATCHLIST,
};

