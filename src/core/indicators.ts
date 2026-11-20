import type { Candle } from './types';

/**
 * Chart indicators, computed so the last value can be refreshed on its own: during a replay
 * the newest candle changes many times a second, and only its value needs recomputing.
 * Every series is an array aligned with the bars; NaN means "not enough bars yet".
 */

export type MaKind = 'ema' | 'sma';

export interface MaConfig {
  on: boolean;
  kind: MaKind;
  period: number;
}

export interface IndicatorConfig {
  ma: [MaConfig, MaConfig, MaConfig];
  bb: { on: boolean; period: number; mult: number };
  rsi: { on: boolean; period: number };
  volume: boolean;
}

export const DEFAULT_INDICATORS: IndicatorConfig = {
  ma: [
    { on: true, kind: 'ema', period: 20 },
    { on: true, kind: 'ema', period: 50 },
    { on: false, kind: 'sma', period: 200 },
  ],
  bb: { on: false, period: 20, mult: 2 },
  rsi: { on: false, period: 14 },
  volume: false,
};

export function normaliseIndicators(c: Partial<IndicatorConfig> | undefined): IndicatorConfig {
  const d = DEFAULT_INDICATORS;
  const ma = (c?.ma ?? d.ma).map((m, i) => ({ ...d.ma[i], ...m, period: clampPeriod(m?.period ?? d.ma[i].period) })) as IndicatorConfig['ma'];
  return {
    ma: ma.length === 3 ? ma : d.ma,
    bb: { ...d.bb, ...(c?.bb ?? {}), period: clampPeriod(c?.bb?.period ?? d.bb.period) },
    rsi: { ...d.rsi, ...(c?.rsi ?? {}), period: clampPeriod(c?.rsi?.period ?? d.rsi.period) },
    volume: c?.volume ?? d.volume,
  };
}

const clampPeriod = (n: number) => Math.min(500, Math.max(2, Math.round(Number(n) || 2)));

/** Exponential moving average. Seeded with the simple average of the first `period` closes. */
export class Ema {
  readonly values: number[] = [];
  private readonly k: number;
  constructor(readonly period: number) {
    this.k = 2 / (period + 1);
  }
  reset(bars: Candle[]): void {
    this.values.length = 0;
    for (let i = 0; i < bars.length; i++) this.at(bars, i);
  }
  /** Compute (or recompute) the value at index i, assuming values before i are final. */
  at(bars: Candle[], i: number): number {
    const n = this.period;
    let v: number;
    if (i < n - 1) v = NaN;
    else if (i === n - 1) {
      let sum = 0;
      for (let j = 0; j < n; j++) sum += bars[j].close;
      v = sum / n;
    } else v = bars[i].close * this.k + this.values[i - 1] * (1 - this.k);
    this.values[i] = v;
    this.values.length = i + 1;
    return v;
  }
}

/** Simple moving average. */
export class Sma {
  readonly values: number[] = [];
  constructor(readonly period: number) {}
  reset(bars: Candle[]): void {
    this.values.length = 0;
    for (let i = 0; i < bars.length; i++) this.at(bars, i);
  }
  at(bars: Candle[], i: number): number {
    const n = this.period;
    let v = NaN;
    if (i >= n - 1) {
      let sum = 0;
      for (let j = i - n + 1; j <= i; j++) sum += bars[j].close;
      v = sum / n;
    }
    this.values[i] = v;
    this.values.length = i + 1;
    return v;
  }
}

/** Bollinger Bands: SMA of closes plus / minus `mult` population standard deviations. */
export class Bollinger {
  readonly mid: number[] = [];
  readonly upper: number[] = [];
  readonly lower: number[] = [];
  constructor(
    readonly period: number,
    readonly mult: number,
  ) {}
  reset(bars: Candle[]): void {
    this.mid.length = this.upper.length = this.lower.length = 0;
    for (let i = 0; i < bars.length; i++) this.at(bars, i);
  }
  at(bars: Candle[], i: number): void {
    const n = this.period;
    let m = NaN;
    let sd = NaN;
    if (i >= n - 1) {
      let sum = 0;
      for (let j = i - n + 1; j <= i; j++) sum += bars[j].close;
      m = sum / n;
      let sq = 0;
      for (let j = i - n + 1; j <= i; j++) sq += (bars[j].close - m) ** 2;
      sd = Math.sqrt(sq / n);
    }
    this.mid[i] = m;
    this.upper[i] = m + this.mult * sd;
    this.lower[i] = m - this.mult * sd;
    this.mid.length = this.upper.length = this.lower.length = i + 1;
  }
}

/** Relative Strength Index with Wilder's smoothing (the standard RSI, as on most platforms). */
export class Rsi {
  readonly values: number[] = [];
  private gain: number[] = [];
  private loss: number[] = [];
  constructor(readonly period: number) {}
  reset(bars: Candle[]): void {
    this.values.length = this.gain.length = this.loss.length = 0;
    for (let i = 0; i < bars.length; i++) this.at(bars, i);
  }
  at(bars: Candle[], i: number): number {
    const n = this.period;
    let g = NaN;
    let l = NaN;
    if (i === n) {
      let sg = 0;
      let sl = 0;
      for (let j = 1; j <= n; j++) {
        const d = bars[j].close - bars[j - 1].close;
        if (d > 0) sg += d;
        else sl -= d;
      }
      g = sg / n;
      l = sl / n;
    } else if (i > n) {
      const d = bars[i].close - bars[i - 1].close;
      g = (this.gain[i - 1] * (n - 1) + Math.max(d, 0)) / n;
      l = (this.loss[i - 1] * (n - 1) + Math.max(-d, 0)) / n;
    }
    this.gain[i] = g;
    this.loss[i] = l;
    this.gain.length = this.loss.length = i + 1;
    const v = Number.isNaN(g) ? NaN : l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l);
    this.values[i] = v;
    this.values.length = i + 1;
    return v;
  }
}

/** Average true range (Wilder), used to size the default long / short position tool. */
export function atr(bars: Candle[], period = 14): number {
  if (bars.length < 2) return bars.length ? bars[0].high - bars[0].low : 0;
  const from = Math.max(1, bars.length - period * 3);
  let a = NaN;
  for (let i = from; i < bars.length; i++) {
    const tr = Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - bars[i - 1].close), Math.abs(bars[i].low - bars[i - 1].close));
    a = Number.isNaN(a) ? tr : (a * (period - 1) + tr) / period;
  }
  return a;
}
