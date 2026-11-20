import { describe, expect, it } from 'vitest';
import { Bollinger, Ema, Rsi, Sma, atr, normaliseIndicators } from '../indicators';
import type { Candle } from '../types';

const bar = (i: number, close: number, spread = 1): Candle => ({ time: i * 60, open: close, high: close + spread, low: close - spread, close, volume: 1 });
const series = (closes: number[]) => closes.map((c, i) => bar(i, c));

describe('moving averages', () => {
  it('SMA averages the last n closes', () => {
    const s = new Sma(3);
    s.reset(series([1, 2, 3, 4, 5]));
    expect(s.values.slice(0, 2).every(Number.isNaN)).toBe(true);
    expect(s.values.slice(2)).toEqual([2, 3, 4]);
  });

  it('EMA is seeded with the SMA and then smooths with 2 / (n + 1)', () => {
    const e = new Ema(3);
    e.reset(series([1, 2, 3, 4]));
    expect(e.values[2]).toBe(2);
    expect(e.values[3]).toBeCloseTo(4 * 0.5 + 2 * 0.5, 10);
  });

  it('recomputing only the last bar matches a full recompute', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 3) * 5 + i * 0.1);
    const bars = series(closes);
    const e = new Ema(10);
    e.reset(bars);
    // The newest candle keeps changing during a replay.
    bars[59] = bar(59, 120);
    e.at(bars, 59);
    const full = new Ema(10);
    full.reset(bars);
    expect(e.values[59]).toBeCloseTo(full.values[59], 12);
    // A new candle appended.
    bars.push(bar(60, 118));
    e.at(bars, 60);
    full.reset(bars);
    expect(e.values).toHaveLength(61);
    expect(e.values[60]).toBeCloseTo(full.values[60], 12);
  });
});

describe('RSI', () => {
  it('is 100 when every close is higher and 50 when gains equal losses', () => {
    const up = new Rsi(5);
    up.reset(series([1, 2, 3, 4, 5, 6, 7, 8]));
    expect(up.values[4]).toBeNaN();
    expect(up.values[5]).toBe(100);
    const flat = new Rsi(4);
    flat.reset(series([10, 11, 10, 11, 10, 11, 10]));
    expect(flat.values[4]).toBeCloseTo(50, 10);
  });

  it('matches the textbook Wilder calculation', () => {
    // Closes from Wilder's worked example (14-period RSI ~ 70.53 on the 15th change).
    const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.0];
    const r = new Rsi(14);
    r.reset(series(closes));
    expect(r.values[14]).toBeCloseTo(70.46, 1);
    expect(r.values[15]).toBeCloseTo(66.25, 1);
  });
});

describe('Bollinger Bands', () => {
  it('uses the population standard deviation around the SMA', () => {
    const b = new Bollinger(4, 2);
    b.reset(series([2, 4, 4, 4, 5, 5, 7, 9]));
    // Last four closes 5, 5, 7, 9: mean 6.5, population sd = sqrt(2.75)
    expect(b.mid[7]).toBe(6.5);
    expect(b.upper[7]).toBeCloseTo(6.5 + 2 * Math.sqrt(2.75), 10);
    expect(b.lower[7]).toBeCloseTo(6.5 - 2 * Math.sqrt(2.75), 10);
  });
});

describe('ATR and settings', () => {
  it('ATR of constant-range bars equals the range', () => {
    expect(atr(series(Array(30).fill(100)))).toBeCloseTo(2, 10);
  });

  it('fills in and clamps saved indicator settings', () => {
    const c = normaliseIndicators({ rsi: { on: true, period: 1 } } as never);
    expect(c.rsi).toEqual({ on: true, period: 2 });
    expect(c.ma).toHaveLength(3);
    expect(c.volume).toBe(false);
  });
});
