import type { Instrument } from './types';

function fx(symbol: string, pipSize: number, digits: number): Instrument {
  return {
    symbol,
    base: symbol.slice(0, 3),
    quote: symbol.slice(3, 6),
    pipSize,
    contractSize: 100_000,
    digits,
    minLot: 0.01,
    lotStep: 0.01,
  };
}

/** Built-in contract specs. Brokers differ slightly; users can override them in Settings. */
export const INSTRUMENTS: Instrument[] = [
  fx('EURUSD', 0.0001, 5),
  fx('GBPUSD', 0.0001, 5),
  fx('AUDUSD', 0.0001, 5),
  fx('NZDUSD', 0.0001, 5),
  fx('USDJPY', 0.01, 3),
  fx('USDCHF', 0.0001, 5),
  fx('USDCAD', 0.0001, 5),
  fx('EURJPY', 0.01, 3),
  fx('GBPJPY', 0.01, 3),
  fx('AUDJPY', 0.01, 3),
  fx('EURGBP', 0.0001, 5),
  fx('EURAUD', 0.0001, 5),
  fx('GBPAUD', 0.0001, 5),
  fx('EURCHF', 0.0001, 5),
  { symbol: 'XAUUSD', base: 'XAU', quote: 'USD', pipSize: 0.1, contractSize: 100, digits: 2, minLot: 0.01, lotStep: 0.01 },
  { symbol: 'XAGUSD', base: 'XAG', quote: 'USD', pipSize: 0.01, contractSize: 5000, digits: 3, minLot: 0.01, lotStep: 0.01 },
  // NSE currency futures: 1 lot = USD 1,000, tick size Rs 0.0025. Lots are whole contracts.
  { symbol: 'USDINR', base: 'USD', quote: 'INR', pipSize: 0.0025, contractSize: 1000, digits: 4, minLot: 1, lotStep: 1 },
  // Crypto: 1 lot = 1 coin, a "pip" is one dollar for BTC. USDT is treated as USD.
  { symbol: 'BTCUSDT', base: 'BTC', quote: 'USDT', pipSize: 1, contractSize: 1, digits: 2, minLot: 0.001, lotStep: 0.001 },
  { symbol: 'BTCUSD', base: 'BTC', quote: 'USD', pipSize: 1, contractSize: 1, digits: 2, minLot: 0.001, lotStep: 0.001 },
  { symbol: 'ETHUSDT', base: 'ETH', quote: 'USDT', pipSize: 0.1, contractSize: 1, digits: 2, minLot: 0.001, lotStep: 0.001 },
  { symbol: 'SOLUSDT', base: 'SOL', quote: 'USDT', pipSize: 0.01, contractSize: 1, digits: 3, minLot: 0.01, lotStep: 0.01 },
  // CFDs as most brokers quote them; edit the specs in Settings to match yours.
  { symbol: 'NAS100', base: 'NAS', quote: 'USD', pipSize: 1, contractSize: 1, digits: 2, minLot: 0.01, lotStep: 0.01 },
  { symbol: 'USOIL', base: 'OIL', quote: 'USD', pipSize: 0.01, contractSize: 1000, digits: 3, minLot: 0.01, lotStep: 0.01 },
  // CME Group futures, front month. 1 lot = 1 contract; a "pip" is one tick.
  // Gold (COMEX GC): 100 troy oz, tick 0.10 = $10. E-mini Nasdaq-100 (NQ): $20 x index, tick 0.25 = $5.
  // WTI crude (NYMEX CL): 1,000 barrels, tick 0.01 = $10.
  { symbol: 'GC1', base: 'GC', quote: 'USD', pipSize: 0.1, contractSize: 100, digits: 1, minLot: 1, lotStep: 1 },
  { symbol: 'NQ1', base: 'NQ', quote: 'USD', pipSize: 0.25, contractSize: 20, digits: 2, minLot: 1, lotStep: 1 },
  { symbol: 'CL1', base: 'CL', quote: 'USD', pipSize: 0.01, contractSize: 1000, digits: 2, minLot: 1, lotStep: 1 },
];

/** Other names brokers and TradingView use for the same market. */
export const SYMBOL_ALIASES: Record<string, string> = {
  NDX: 'NAS100',
  NASDAQ: 'NAS100',
  NASDAQ100: 'NAS100',
  US100: 'NAS100',
  USTEC: 'NAS100',
  USTECH: 'NAS100',
  XTIUSD: 'USOIL',
  WTI: 'USOIL',
  WTIUSD: 'USOIL',
  GOLD: 'XAUUSD',
  XBTUSD: 'BTCUSD',
  GC: 'GC1',
  NQ: 'NQ1',
  CL: 'CL1',
};

export type AssetClass = 'forex' | 'metal' | 'crypto' | 'index' | 'energy' | 'futures';

/** Display name, description and class for the symbols EdgeLab knows. */
export const SYMBOL_INFO: Record<string, { display?: string; description: string; kind: AssetClass }> = {
  EURUSD: { description: 'Euro / U.S. Dollar', kind: 'forex' },
  GBPUSD: { description: 'British Pound / U.S. Dollar', kind: 'forex' },
  AUDUSD: { description: 'Australian Dollar / U.S. Dollar', kind: 'forex' },
  NZDUSD: { description: 'New Zealand Dollar / U.S. Dollar', kind: 'forex' },
  USDJPY: { description: 'U.S. Dollar / Japanese Yen', kind: 'forex' },
  USDCHF: { description: 'U.S. Dollar / Swiss Franc', kind: 'forex' },
  USDCAD: { description: 'U.S. Dollar / Canadian Dollar', kind: 'forex' },
  EURJPY: { description: 'Euro / Japanese Yen', kind: 'forex' },
  GBPJPY: { description: 'British Pound / Japanese Yen', kind: 'forex' },
  AUDJPY: { description: 'Australian Dollar / Japanese Yen', kind: 'forex' },
  EURGBP: { description: 'Euro / British Pound', kind: 'forex' },
  EURAUD: { description: 'Euro / Australian Dollar', kind: 'forex' },
  GBPAUD: { description: 'British Pound / Australian Dollar', kind: 'forex' },
  EURCHF: { description: 'Euro / Swiss Franc', kind: 'forex' },
  USDINR: { description: 'U.S. Dollar / Indian Rupee futures (NSE)', kind: 'forex' },
  XAUUSD: { description: 'Gold / U.S. Dollar', kind: 'metal' },
  XAGUSD: { description: 'Silver / U.S. Dollar', kind: 'metal' },
  BTCUSD: { description: 'Bitcoin / U.S. Dollar', kind: 'crypto' },
  BTCUSDT: { description: 'Bitcoin / TetherUS', kind: 'crypto' },
  ETHUSDT: { description: 'Ethereum / TetherUS', kind: 'crypto' },
  SOLUSDT: { description: 'Solana / TetherUS', kind: 'crypto' },
  NAS100: { display: 'NASDAQ', description: 'Nasdaq 100 index', kind: 'index' },
  USOIL: { description: 'WTI crude oil', kind: 'energy' },
  GC1: { display: 'GC1!', description: 'Gold futures, front month', kind: 'futures' },
  NQ1: { display: 'NQ1!', description: 'E-mini Nasdaq-100 futures, front month', kind: 'futures' },
  CL1: { display: 'CL1!', description: 'WTI crude oil futures, front month', kind: 'futures' },
};

export function displaySymbol(symbol: string): string {
  return SYMBOL_INFO[symbol]?.display ?? symbol;
}

/** "OANDA:XAUUSD", "CME_MINI:NQ1!", "NASDAQ:NDX" -> the EdgeLab symbol (XAUUSD, NQ1, NAS100). */
export function symbolFromTradingView(tv: string): string {
  const raw = normaliseSymbol(tv.includes(':') ? tv.slice(tv.indexOf(':') + 1) : tv);
  return SYMBOL_ALIASES[raw] ?? raw;
}

/** Typical retail spreads in pips, used as the default when a backtest starts. */
export const DEFAULT_SPREAD_PIPS: Record<string, number> = {
  EURUSD: 0.8,
  GBPUSD: 1.2,
  AUDUSD: 1.0,
  NZDUSD: 1.4,
  USDJPY: 1.0,
  USDCHF: 1.3,
  USDCAD: 1.4,
  EURJPY: 1.5,
  GBPJPY: 2.2,
  AUDJPY: 1.6,
  EURGBP: 1.2,
  EURAUD: 1.8,
  GBPAUD: 2.4,
  EURCHF: 1.6,
  XAUUSD: 2.5,
  XAGUSD: 2.5,
  USDINR: 1,
  BTCUSDT: 2,
  BTCUSD: 2,
  ETHUSDT: 2,
  SOLUSDT: 2,
  NAS100: 1.5,
  USOIL: 3,
  GC1: 1,
  NQ1: 1,
  CL1: 1,
};

/**
 * Rough USD value of one unit of each currency. Only used to convert P&L of cross pairs
 * (for example EURGBP in a USD account). Edit them in Settings for exact numbers.
 */
export const DEFAULT_USD_VALUE: Record<string, number> = {
  USD: 1,
  USDT: 1,
  EUR: 1.1,
  GBP: 1.3,
  JPY: 0.0067,
  CHF: 1.15,
  CAD: 0.72,
  AUD: 0.65,
  NZD: 0.58,
  INR: 0.0116,
};

export const ACCOUNT_CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'JPY', 'AUD', 'CAD', 'CHF'];

/** Normalise a broker symbol such as "EURUSD.m", "EUR/USD", "eurusd_i" or "XAUUSD+" to "EURUSD". */
export function normaliseSymbol(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function findInstrument(symbol: string, custom: Instrument[] = []): Instrument | undefined {
  const n = normaliseSymbol(symbol);
  const s = SYMBOL_ALIASES[n] ?? n;
  const all = [...custom, ...INSTRUMENTS];
  return all.find((i) => i.symbol === s) ?? all.find((i) => s.startsWith(i.symbol));
}

/** Guess the symbol from a file name such as "EURUSD_M1_2024.csv" or "xauusd-m5.csv". */
export function guessSymbolFromName(name: string, custom: Instrument[] = []): string | undefined {
  const s = name.toUpperCase().replace(/[^A-Z0-9]/g, ' ');
  const compact = s.replace(/\s+/g, '');
  const all = [...custom, ...INSTRUMENTS];
  return all.find((i) => compact.includes(i.symbol))?.symbol;
}

/** Spec for a symbol that is not built in (for example an index CFD), with neutral defaults. */
export function customInstrument(symbol: string, pipSize = 0.0001, contractSize = 100_000, digits = 5): Instrument {
  const s = normaliseSymbol(symbol);
  return {
    symbol: s,
    base: s.slice(0, 3),
    quote: s.length >= 6 ? s.slice(3, 6) : 'USD',
    pipSize,
    contractSize,
    digits,
    minLot: 0.01,
    lotStep: 0.01,
  };
}
