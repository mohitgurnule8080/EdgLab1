import type { Candle } from './types';
import { bucketStart } from './time';

/**
 * Display bars built from base (imported) candles, plus the index maps the replay needs:
 * which display bar each base candle belongs to, and where each display bar starts.
 */
export interface Aggregation {
  tfSec: number;
  bars: Candle[];
  /** groupOf[baseIndex] = index of the display bar that contains it */
  groupOf: Int32Array;
  /** firstBase[barIndex] = first base index of that display bar */
  firstBase: Int32Array;
}

export function buildAggregation(base: Candle[], tfSec: number): Aggregation {
  const groupOf = new Int32Array(base.length);
  const bars: Candle[] = [];
  const first: number[] = [];
  let key = Number.NaN;
  for (let i = 0; i < base.length; i++) {
    const c = base[i];
    const k = bucketStart(c.time, tfSec);
    if (k !== key) {
      key = k;
      bars.push({ time: k, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume });
      first.push(i);
    } else {
      const b = bars[bars.length - 1];
      if (c.high > b.high) b.high = c.high;
      if (c.low < b.low) b.low = c.low;
      b.close = c.close;
      b.volume += c.volume;
    }
    groupOf[i] = bars.length - 1;
  }
  return { tfSec, bars, groupOf, firstBase: Int32Array.from(first) };
}

export function resample(base: Candle[], tfSec: number): Candle[] {
  return buildAggregation(base, tfSec).bars;
}

/** Last base index belonging to display bar `g`. */
export function lastBaseOf(agg: Aggregation, g: number, baseLength: number): number {
  return g + 1 < agg.firstBase.length ? agg.firstBase[g + 1] - 1 : baseLength - 1;
}

/** The display bar that contains base index `upto`, built only from candles up to `upto` (no look-ahead). */
export function partialBar(base: Candle[], agg: Aggregation, upto: number): Candle {
  const g = agg.groupOf[upto];
  const start = agg.firstBase[g];
  const c0 = base[start];
  const bar: Candle = { time: agg.bars[g].time, open: c0.open, high: c0.high, low: c0.low, close: c0.close, volume: c0.volume };
  for (let i = start + 1; i <= upto; i++) {
    const c = base[i];
    if (c.high > bar.high) bar.high = c.high;
    if (c.low < bar.low) bar.low = c.low;
    bar.close = c.close;
    bar.volume += c.volume;
  }
  return bar;
}

/** Display bars visible when the replay cursor is at base index `cursor`: complete bars plus the forming one. */
export function visibleBars(base: Candle[], agg: Aggregation, cursor: number): Candle[] {
  const g = agg.groupOf[cursor];
  const bars = agg.bars.slice(0, g);
  bars.push(partialBar(base, agg, cursor));
  return bars;
}
