import type { TradeRecord } from './types';
import { dateKey, sessionOf, weekdayName, zonedParts, SESSION_ORDER } from './time';

export interface TradeStats {
  trades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number;
  grossProfit: number;
  grossLoss: number;
  netPnl: number;
  /** Gross profit / gross loss. Infinity when there are no losses. */
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  /** Average win / average loss. */
  payoff: number;
  /** Average net P&L per trade. */
  expectancy: number;
  /** Trades that have an R value (had a stop loss). */
  rTrades: number;
  avgR: number;
  totalR: number;
  /** Van Tharp's System Quality Number, sqrt(min(n,100)) * mean(R) / stdev(R). */
  sqn: number | null;
  largestWin: number;
  largestLoss: number;
  maxConsecWins: number;
  maxConsecLosses: number;
  /** Largest peak-to-trough fall of cumulative P&L, as a positive amount. */
  maxDrawdown: number;
  /** Same in R. */
  maxDrawdownR: number;
  /** Relative to peak equity; needs a starting balance. */
  maxDrawdownPct: number | null;
  avgHoldSec: number;
  totalFees: number;
}

const byExit = (a: TradeRecord, b: TradeRecord) => a.exitTime - b.exitTime || a.entryTime - b.entryTime;

export function sortByExit(trades: TradeRecord[]): TradeRecord[] {
  return [...trades].sort(byExit);
}

export function computeStats(input: TradeRecord[], startingBalance = 0): TradeStats {
  const trades = sortByExit(input);
  const n = trades.length;
  let wins = 0;
  let losses = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let largestWin = 0;
  let largestLoss = 0;
  let streakW = 0;
  let streakL = 0;
  let maxW = 0;
  let maxL = 0;
  let hold = 0;
  let fees = 0;
  const rs: number[] = [];
  let cum = 0;
  let peak = 0;
  let maxDd = 0;
  let cumR = 0;
  let peakR = 0;
  let maxDdR = 0;
  let maxDdPct = 0;

  for (const t of trades) {
    const pnl = t.pnl;
    if (pnl > 0) {
      wins++;
      grossProfit += pnl;
      largestWin = Math.max(largestWin, pnl);
      streakW++;
      streakL = 0;
    } else if (pnl < 0) {
      losses++;
      grossLoss += -pnl;
      largestLoss = Math.min(largestLoss, pnl);
      streakL++;
      streakW = 0;
    } else {
      streakW = 0;
      streakL = 0;
    }
    maxW = Math.max(maxW, streakW);
    maxL = Math.max(maxL, streakL);
    hold += Math.max(0, t.exitTime - t.entryTime);
    fees += t.fees || 0;

    cum += pnl;
    peak = Math.max(peak, cum);
    maxDd = Math.max(maxDd, peak - cum);
    if (startingBalance > 0) {
      const peakEq = startingBalance + peak;
      if (peakEq > 0) maxDdPct = Math.max(maxDdPct, (peak - cum) / peakEq);
    }
    if (t.rMultiple !== null && Number.isFinite(t.rMultiple)) {
      rs.push(t.rMultiple);
      cumR += t.rMultiple;
      peakR = Math.max(peakR, cumR);
      maxDdR = Math.max(maxDdR, peakR - cumR);
    }
  }

  const totalR = rs.reduce((a, b) => a + b, 0);
  const avgR = rs.length ? totalR / rs.length : 0;
  let sqn: number | null = null;
  if (rs.length >= 2) {
    const variance = rs.reduce((a, r) => a + (r - avgR) ** 2, 0) / (rs.length - 1);
    const sd = Math.sqrt(variance);
    sqn = sd > 0 ? (Math.sqrt(Math.min(rs.length, 100)) * avgR) / sd : null;
  }
  const avgWin = wins ? grossProfit / wins : 0;
  const avgLoss = losses ? grossLoss / losses : 0;

  return {
    trades: n,
    wins,
    losses,
    breakeven: n - wins - losses,
    winRate: n ? wins / n : 0,
    grossProfit,
    grossLoss,
    netPnl: grossProfit - grossLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    avgWin,
    avgLoss,
    payoff: avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? Infinity : 0,
    expectancy: n ? (grossProfit - grossLoss) / n : 0,
    rTrades: rs.length,
    avgR,
    totalR,
    sqn,
    largestWin,
    largestLoss,
    maxConsecWins: maxW,
    maxConsecLosses: maxL,
    maxDrawdown: maxDd,
    maxDrawdownR: maxDdR,
    maxDrawdownPct: startingBalance > 0 ? maxDdPct : null,
    avgHoldSec: n ? hold / n : 0,
    totalFees: fees,
  };
}

export interface EquityPoint {
  index: number;
  time: number;
  pnl: number;
  r: number;
}

/** Cumulative P&L and R after each trade, in exit order. Starts with a zero point. */
export function equityCurve(input: TradeRecord[]): EquityPoint[] {
  const trades = sortByExit(input);
  const pts: EquityPoint[] = [{ index: 0, time: trades[0]?.entryTime ?? 0, pnl: 0, r: 0 }];
  let pnl = 0;
  let r = 0;
  trades.forEach((t, i) => {
    pnl += t.pnl;
    r += t.rMultiple ?? 0;
    pts.push({ index: i + 1, time: t.exitTime, pnl, r });
  });
  return pts;
}

export interface BreakdownRow {
  key: string;
  stats: TradeStats;
}

/** Group trades by one or many keys per trade (tags and mistakes give several). */
export function breakdown(trades: TradeRecord[], keyOf: (t: TradeRecord) => string | string[], order?: string[]): BreakdownRow[] {
  const groups = new Map<string, TradeRecord[]>();
  for (const t of trades) {
    const k = keyOf(t);
    const keys = Array.isArray(k) ? k : [k];
    for (const key of keys) {
      if (!key) continue;
      const list = groups.get(key);
      if (list) list.push(t);
      else groups.set(key, [t]);
    }
  }
  const rows = [...groups.entries()].map(([key, list]) => ({ key, stats: computeStats(list) }));
  if (order) rows.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  else rows.sort((a, b) => b.stats.trades - a.stats.trades || b.stats.netPnl - a.stats.netPnl);
  return rows;
}

export const WEEKDAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function bySession(trades: TradeRecord[]): BreakdownRow[] {
  return breakdown(trades, (t) => sessionOf(t.entryTime), SESSION_ORDER);
}

export function byWeekday(trades: TradeRecord[], tz: string): BreakdownRow[] {
  return breakdown(trades, (t) => weekdayName(zonedParts(t.entryTime, tz).weekday), WEEKDAY_ORDER);
}

export interface DayCell {
  pnl: number;
  trades: number;
  r: number;
}

/** Net P&L per calendar day (by exit date) in the display time zone. */
export function dailyPnl(trades: TradeRecord[], tz: string): Map<string, DayCell> {
  const map = new Map<string, DayCell>();
  for (const t of trades) {
    const key = dateKey(t.exitTime, tz);
    const cell = map.get(key) ?? { pnl: 0, trades: 0, r: 0 };
    cell.pnl += t.pnl;
    cell.trades += 1;
    cell.r += t.rMultiple ?? 0;
    map.set(key, cell);
  }
  return map;
}

/** Human label for an SQN value (Van Tharp's scale). */
export function sqnLabel(sqn: number | null): string {
  if (sqn === null) return 'Need 2+ trades with a stop loss';
  if (sqn < 1.6) return 'Poor';
  if (sqn < 2) return 'Below average';
  if (sqn < 2.5) return 'Average';
  if (sqn < 3) return 'Good';
  if (sqn < 5) return 'Excellent';
  if (sqn < 7) return 'Superb';
  return 'Exceptional (check sample size)';
}
