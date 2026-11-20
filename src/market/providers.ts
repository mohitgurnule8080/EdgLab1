import type { Candle } from '../core/types';
import type { ProviderId } from '../store/db';
import { SYMBOL_ALIASES } from '../core/instruments';

/**
 * Market data providers that work straight from the browser.
 *  - Binance: free public candles for crypto, no key.
 *  - Twelve Data: forex (and more on paid plans) with the user's own free API key.
 * Both return closed candles only, oldest first, in UTC seconds.
 */

export type ErrorKind = 'rate-limit' | 'plan' | 'auth' | 'symbol' | 'network' | 'other';

export class ProviderError extends Error {
  kind: ErrorKind;
  constructor(kind: ErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

export interface CandleRequest {
  symbol: string;
  tfSec: number;
  /** UTC seconds, inclusive */
  from: number;
  /** UTC seconds */
  to: number;
  apiKey?: string;
  maxBars?: number;
  signal?: AbortSignal;
  onProgress?(count: number): void;
  fetchImpl?: typeof fetch;
  /** Current time in seconds, injectable for tests. */
  now?: number;
}

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  needsKey: boolean;
  timeframes: number[];
  examples: string[];
  note: string;
}

const BINANCE_INTERVALS: Record<number, string> = { 60: '1m', 300: '5m', 900: '15m', 1800: '30m', 3600: '1h', 14400: '4h', 86400: '1d', 604800: '1w' };
const TD_INTERVALS: Record<number, string> = { 60: '1min', 300: '5min', 900: '15min', 1800: '30min', 3600: '1h', 14400: '4h', 86400: '1day', 604800: '1week' };

export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'binance',
    name: 'Binance',
    needsKey: false,
    timeframes: Object.keys(BINANCE_INTERVALS).map(Number),
    examples: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'],
    note: 'Crypto, free, no key. Live candles since each coin was listed.',
  },
  {
    id: 'twelvedata',
    name: 'Twelve Data',
    needsKey: true,
    timeframes: Object.keys(TD_INTERVALS).map(Number),
    examples: ['EUR/USD', 'GBP/USD', 'USD/JPY', 'XAU/USD'],
    note: 'Forex with a free API key (8 requests a minute, 800 a day). Metals, oil and indices may need a paid plan.',
  },
];

/** BTCUSDT, EUR/USD, WTI/USD, NDX -> EdgeLab symbols BTCUSDT, EURUSD, USOIL, NAS100. */
export function localSymbol(remote: string): string {
  const s = remote.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return SYMBOL_ALIASES[s] ?? s;
}

/** Where candles for an EdgeLab symbol can be downloaded from, if anywhere. */
export function providerFor(symbol: string): { provider: ProviderId; remote: string } | null {
  if (/USDT$/.test(symbol)) return { provider: 'binance', remote: symbol };
  const td: Record<string, string> = { XAUUSD: 'XAU/USD', XAGUSD: 'XAG/USD', BTCUSD: 'BTC/USD', USOIL: 'WTI/USD', NAS100: 'NDX' };
  if (td[symbol]) return { provider: 'twelvedata', remote: td[symbol] };
  if (/^[A-Z]{6}$/.test(symbol) && symbol !== 'USDINR') return { provider: 'twelvedata', remote: `${symbol.slice(0, 3)}/${symbol.slice(3)}` };
  return null;
}

/** Sort, drop duplicates (later wins) and bad rows. */
export function cleanCandles(list: Candle[]): Candle[] {
  const byTime = new Map<number, Candle>();
  for (const c of list) {
    if (![c.time, c.open, c.high, c.low, c.close].every(Number.isFinite) || c.open <= 0) continue;
    byTime.set(c.time, { ...c, high: Math.max(c.high, c.open, c.close), low: Math.min(c.low, c.open, c.close) });
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

export function mergeCandles(existing: Candle[], incoming: Candle[]): Candle[] {
  return cleanCandles([...existing, ...incoming]);
}

const BINANCE_HOSTS = ['https://api.binance.com', 'https://data-api.binance.vision'];

export async function fetchBinance(req: CandleRequest): Promise<Candle[]> {
  const interval = BINANCE_INTERVALS[req.tfSec];
  if (!interval) throw new ProviderError('other', 'Binance does not offer this timeframe.');
  const f = req.fetchImpl ?? fetch;
  const nowMs = (req.now ?? Date.now() / 1000) * 1000;
  const endMs = Math.min(req.to * 1000, nowMs);
  const max = req.maxBars ?? 250_000;
  const out: Candle[] = [];
  let start = req.from * 1000;
  let host = 0;
  while (start < endMs && out.length < max) {
    const url = `${BINANCE_HOSTS[host]}/api/v3/klines?symbol=${encodeURIComponent(req.symbol.toUpperCase())}&interval=${interval}&startTime=${start}&endTime=${Math.floor(endMs)}&limit=1000`;
    let res: Response;
    try {
      res = await f(url, { signal: req.signal });
    } catch (e) {
      if (req.signal?.aborted) throw e;
      if (host + 1 < BINANCE_HOSTS.length) {
        host++;
        continue;
      }
      throw new ProviderError('network', 'Could not reach Binance. Check your internet connection and try again.');
    }
    if (res.status === 429 || res.status === 418) throw new ProviderError('rate-limit', 'Binance is rate limiting requests. Wait a minute and try again.');
    if (res.status === 451 || res.status === 403) {
      if (host + 1 < BINANCE_HOSTS.length) {
        host++;
        continue;
      }
      throw new ProviderError('plan', 'Binance refused the request from this location.');
    }
    const body = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) {
      const msg = (body as { msg?: string } | null)?.msg ?? `HTTP ${res.status}`;
      throw new ProviderError(/symbol/i.test(msg) ? 'symbol' : 'other', /symbol/i.test(msg) ? `Binance does not list ${req.symbol.toUpperCase()}. Use a pair such as BTCUSDT.` : `Binance: ${msg}`);
    }
    if (!Array.isArray(body) || body.length === 0) break;
    for (const k of body as (string | number)[][]) {
      if (Number(k[6]) > nowMs) continue; // still forming
      out.push({ time: Math.floor(Number(k[0]) / 1000), open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), volume: Number(k[5]) });
    }
    req.onProgress?.(out.length);
    const lastOpen = Number((body[body.length - 1] as (string | number)[])[0]);
    const next = lastOpen + req.tfSec * 1000;
    if (body.length < 1000 || next <= start) break;
    start = next;
  }
  return cleanCandles(out).slice(-max);
}

function tdTime(s: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)) / 1000;
}

const tdDate = (t: number) => new Date(t * 1000).toISOString().slice(0, 19).replace('T', ' ');

function tdError(code: number, message = ''): ProviderError {
  if (code === 429) return new ProviderError('rate-limit', 'Twelve Data limit reached (the free plan allows 8 requests a minute and 800 a day). Try again in a minute.');
  if (code === 401) return new ProviderError('auth', 'Twelve Data rejected the API key. Check it in Settings.');
  if (code === 403) return new ProviderError('plan', 'This symbol or timeframe is not on your Twelve Data plan.');
  if (code === 400 || code === 404) return new ProviderError('symbol', message ? `Twelve Data: ${message}` : 'Twelve Data could not find that symbol. Use the EUR/USD format.');
  return new ProviderError('other', message ? `Twelve Data: ${message}` : `Twelve Data error ${code}.`);
}

export async function fetchTwelveData(req: CandleRequest & { maxCalls?: number }): Promise<Candle[]> {
  const interval = TD_INTERVALS[req.tfSec];
  if (!interval) throw new ProviderError('other', 'Twelve Data does not offer this timeframe.');
  if (!req.apiKey) throw new ProviderError('auth', 'Add your free Twelve Data API key in Settings first.');
  const f = req.fetchImpl ?? fetch;
  const now = req.now ?? Math.floor(Date.now() / 1000);
  const maxCalls = req.maxCalls ?? 8;
  const out: Candle[] = [];
  let end = Math.min(req.to, now);
  for (let calls = 0; calls < maxCalls && end > req.from; calls++) {
    const params = new URLSearchParams({
      symbol: req.symbol,
      interval,
      outputsize: '5000',
      start_date: tdDate(req.from),
      end_date: tdDate(end),
      timezone: 'UTC',
      order: 'asc',
      apikey: req.apiKey,
    });
    let res: Response;
    try {
      res = await f(`https://api.twelvedata.com/time_series?${params}`, { signal: req.signal });
    } catch (e) {
      if (req.signal?.aborted) throw e;
      throw new ProviderError('network', 'Could not reach Twelve Data. Check your internet connection and try again.');
    }
    const body = (await res.json().catch(() => null)) as { status?: string; code?: number; message?: string; values?: Record<string, string>[] } | null;
    const code = !res.ok ? res.status : body?.status === 'error' ? Number(body.code) || 400 : 0;
    if (code) {
      if (code === 400 && /no data/i.test(body?.message ?? '')) break;
      throw tdError(code, body?.message);
    }
    const values = body?.values ?? [];
    if (!values.length) break;
    const chunk = values.map((v) => ({
      time: tdTime(v.datetime),
      open: Number(v.open),
      high: Number(v.high),
      low: Number(v.low),
      close: Number(v.close),
      volume: v.volume ? Number(v.volume) : 0,
    }));
    out.push(...chunk);
    req.onProgress?.(out.length);
    const earliest = Math.min(...chunk.map((c) => c.time));
    if (values.length < 5000 || earliest <= req.from) break;
    end = earliest - req.tfSec;
  }
  return cleanCandles(out).filter((c) => c.time + req.tfSec <= now && c.time >= req.from);
}

export function fetchCandles(provider: ProviderId, req: CandleRequest): Promise<Candle[]> {
  return provider === 'binance' ? fetchBinance(req) : fetchTwelveData(req);
}
