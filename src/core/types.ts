export type Side = 'buy' | 'sell';
export type OrderKind = 'market' | 'limit' | 'stop';
export type TradeSource = 'live' | 'backtest';
export type ExitReason = 'sl' | 'tp' | 'manual' | 'end';

/** One OHLC bar. `time` is the bar's open time in UTC seconds. Prices are bid prices. */
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Contract specification of a tradable symbol. */
export interface Instrument {
  symbol: string;
  base: string;
  quote: string;
  /** Size of one pip in price units (0.0001 for EURUSD, 0.01 for USDJPY). */
  pipSize: number;
  /** Units of the base asset in 1.00 lot (100,000 for FX, 100 oz for gold). */
  contractSize: number;
  /** Decimals used to display prices. */
  digits: number;
  minLot: number;
  lotStep: number;
}

/**
 * How profit in the quote currency is converted into the account currency.
 * `usdValue[ccy]` is the value of one unit of `ccy` in USD. It is only used for
 * cross pairs, where neither side of the pair is the account currency.
 */
export interface PricingContext {
  accountCurrency: string;
  usdValue: Record<string, number>;
}

/** A completed trade in the journal: either logged by hand (live) or produced by a backtest. */
export interface TradeRecord {
  id: string;
  source: TradeSource;
  sessionId?: string;
  symbol: string;
  side: Side;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  lots: number;
  sl?: number;
  tp?: number;
  /** Net profit in account currency, after fees. */
  pnl: number;
  /** Commission + swap, in account currency (positive number = cost). */
  fees: number;
  /** Result in R (risk units). Null when the trade had no stop loss. */
  rMultiple: number | null;
  pips: number;
  setup: string;
  tags: string[];
  mistakes: string[];
  emotion: string;
  /** Execution quality from 1 to 5, 0 = not rated. */
  rating: number;
  notes: string;
  screenshot: string;
  exitReason?: ExitReason;
  sample?: boolean;
  createdAt: number;
  updatedAt: number;
}
