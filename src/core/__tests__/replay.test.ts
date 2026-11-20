import { describe, expect, it } from 'vitest';
import { ReplayEngine, type ReplayConfig } from '../replay';
import { findInstrument } from '../instruments';
import type { Candle } from '../types';

const EURUSD = findInstrument('EURUSD')!;
const USD = { accountCurrency: 'USD', usdValue: { USD: 1 } };

let t = 1_700_000_000;
function bar(open: number, high: number, low: number, close: number): Candle {
  t += 3600;
  return { time: t, open, high, low, close, volume: 0 };
}

function engine(candles: Candle[], over: Partial<ReplayConfig> = {}) {
  return new ReplayEngine(candles, {
    instrument: EURUSD,
    pricing: USD,
    startingBalance: 10_000,
    spreadPips: 1,
    commissionPerLot: 0,
    ...over,
  });
}

describe('ReplayEngine fills', () => {
  it('fills a market buy at the ask and exits at TP inside the next candle', () => {
    const e = engine([bar(1.1, 1.1, 1.1, 1.1), bar(1.1, 1.105, 1.099, 1.1045)]);
    const res = e.placeOrder({ side: 'buy', kind: 'market', lots: 1, sl: 1.0981, tp: 1.1041 });
    expect(res.ok).toBe(true);
    expect(e.positions[0].entryPrice).toBeCloseTo(1.1001, 10);
    const events = e.step();
    expect(events.map((x) => x.type)).toEqual(['closed']);
    const tr = e.closed[0];
    expect(tr.exitReason).toBe('tp');
    expect(tr.exitPrice).toBeCloseTo(1.1041, 10);
    expect(tr.pips).toBeCloseTo(40, 6);
    expect(tr.rMultiple).toBeCloseTo(2, 6);
    expect(tr.pnl).toBeCloseTo(400, 6);
    expect(e.balance).toBeCloseTo(10_400, 6);
  });

  it('uses the OHLC path: a bullish candle visits the low first, so SL wins', () => {
    const e = engine([bar(1.1, 1.1, 1.1, 1.1), bar(1.1, 1.105, 1.097, 1.1045)]);
    e.placeOrder({ side: 'buy', kind: 'market', lots: 1, sl: 1.0981, tp: 1.1041 });
    e.step();
    expect(e.closed[0].exitReason).toBe('sl');
    expect(e.closed[0].rMultiple).toBeCloseTo(-1, 6);
  });

  it('uses the OHLC path: a bearish candle visits the high first, so TP wins', () => {
    const e = engine([bar(1.1, 1.1, 1.1, 1.1), bar(1.1, 1.105, 1.097, 1.0975)]);
    e.placeOrder({ side: 'buy', kind: 'market', lots: 1, sl: 1.0981, tp: 1.1041 });
    e.step();
    expect(e.closed[0].exitReason).toBe('tp');
  });

  it('closes shorts at the ask, so a low that only touches TP on the bid does not fill', () => {
    const touch = engine([bar(1.1, 1.1, 1.1, 1.1), bar(1.1, 1.1005, 1.096, 1.0962)]);
    touch.placeOrder({ side: 'sell', kind: 'market', lots: 1, sl: 1.102, tp: 1.096 });
    touch.step();
    expect(touch.closed).toHaveLength(0);

    const through = engine([bar(1.1, 1.1, 1.1, 1.1), bar(1.1, 1.1005, 1.0955, 1.0958)]);
    through.placeOrder({ side: 'sell', kind: 'market', lots: 1, sl: 1.102, tp: 1.096 });
    through.step();
    expect(through.closed[0].exitReason).toBe('tp');
    expect(through.closed[0].pips).toBeCloseTo(40, 6);
    expect(through.closed[0].rMultiple).toBeCloseTo(2, 6);
  });

  it('fills a buy stop and then hits its TP in the same candle', () => {
    const e = engine([bar(1.1, 1.1, 1.1, 1.1), bar(1.1, 1.104, 1.0995, 1.1035)]);
    const res = e.placeOrder({ side: 'buy', kind: 'stop', price: 1.1011, lots: 1, sl: 1.0991, tp: 1.1031 });
    expect(res.ok).toBe(true);
    const events = e.step();
    expect(events.map((x) => x.type)).toEqual(['filled', 'closed']);
    expect(e.closed[0].entryPrice).toBeCloseTo(1.1011, 10);
    expect(e.closed[0].exitReason).toBe('tp');
    expect(e.closed[0].rMultiple).toBeCloseTo(1, 6);
  });

  it('fills stops at the open price when the market gaps through them', () => {
    const e = engine([bar(1.1, 1.1, 1.1, 1.1), bar(1.095, 1.096, 1.094, 1.0955)]);
    e.placeOrder({ side: 'buy', kind: 'market', lots: 1, sl: 1.0981 });
    e.step();
    expect(e.closed[0].exitReason).toBe('sl');
    expect(e.closed[0].exitPrice).toBeCloseTo(1.095, 10);
    expect(e.closed[0].rMultiple).toBeCloseTo(-2.55, 6);
  });

  it('gives limit orders the better open price on a gap', () => {
    const e = engine([bar(1.1, 1.1, 1.1, 1.1), bar(1.097, 1.0975, 1.0965, 1.097)]);
    e.placeOrder({ side: 'buy', kind: 'limit', price: 1.099, lots: 1 });
    e.step();
    expect(e.positions).toHaveLength(1);
    expect(e.positions[0].entryPrice).toBeCloseTo(1.0971, 10);
  });

  it('handles a partial close and a breakeven stop as one trade', () => {
    const e = engine([bar(1.1, 1.1, 1.1, 1.1), bar(1.1, 1.1025, 1.0998, 1.1021), bar(1.1021, 1.1025, 1.099, 1.0995)]);
    e.placeOrder({ side: 'buy', kind: 'market', lots: 1, sl: 1.0981 });
    e.step();
    const id = e.positions[0].id;
    const partial = e.closePosition(id, 0.5);
    expect(partial[0].type).toBe('partial');
    expect(e.balance).toBeCloseTo(10_100, 6);
    expect(e.modifyPosition(id, { sl: 1.1001 }).ok).toBe(true);
    e.step();
    const tr = e.closed[0];
    expect(tr.partials).toBe(2);
    expect(tr.lots).toBeCloseTo(1, 10);
    expect(tr.exitPrice).toBeCloseTo(1.1011, 10);
    expect(tr.rMultiple).toBeCloseTo(0.5, 6);
    expect(tr.pnl).toBeCloseTo(100, 6);
    expect(tr.exitReason).toBe('sl');
  });

  it('charges round-turn commission per lot', () => {
    const e = engine([bar(1.1, 1.1, 1.1, 1.1), bar(1.1, 1.105, 1.099, 1.1045)], { commissionPerLot: 7 });
    e.placeOrder({ side: 'buy', kind: 'market', lots: 2, sl: 1.0981, tp: 1.1041 });
    e.step();
    expect(e.closed[0].commission).toBeCloseTo(14, 6);
    expect(e.closed[0].pnl).toBeCloseTo(800 - 14, 6);
  });

  it('tracks max favourable and adverse excursion', () => {
    const e = engine([bar(1.1, 1.1, 1.1, 1.1), bar(1.1, 1.103, 1.0991, 1.1)]);
    e.placeOrder({ side: 'buy', kind: 'market', lots: 1 });
    e.step();
    const p = e.positions[0];
    expect(p.mfe / EURUSD.pipSize).toBeCloseTo(29, 6);
    expect(p.mae / EURUSD.pipSize).toBeCloseTo(10, 6);
  });

  it('never moves backwards and stops at the last candle', () => {
    const e = engine([bar(1.1, 1.1, 1.1, 1.1), bar(1.1, 1.1, 1.1, 1.1)]);
    e.step(10);
    expect(e.cursor).toBe(1);
    expect(e.atEnd).toBe(true);
    expect(e.stepTo(0)).toEqual([]);
    expect(e.cursor).toBe(1);
  });
});

describe('ReplayEngine validation', () => {
  const e = engine([bar(1.1, 1.1, 1.1, 1.1), bar(1.1, 1.1, 1.1, 1.1)]);
  it('rejects pending orders on the wrong side of the market', () => {
    expect(e.placeOrder({ side: 'buy', kind: 'limit', price: 1.102, lots: 1 }).ok).toBe(false);
    expect(e.placeOrder({ side: 'buy', kind: 'stop', price: 1.099, lots: 1 }).ok).toBe(false);
    expect(e.placeOrder({ side: 'sell', kind: 'limit', price: 1.099, lots: 1 }).ok).toBe(false);
    expect(e.placeOrder({ side: 'sell', kind: 'stop', price: 1.102, lots: 1 }).ok).toBe(false);
  });
  it('rejects stops on the wrong side', () => {
    expect(e.placeOrder({ side: 'buy', kind: 'market', lots: 1, sl: 1.101 }).ok).toBe(false);
    expect(e.placeOrder({ side: 'sell', kind: 'market', lots: 1, tp: 1.101 }).ok).toBe(false);
    expect(e.placeOrder({ side: 'buy', kind: 'market', lots: 0.001 }).ok).toBe(false);
  });
  it('survives a save / restore round trip', () => {
    const a = engine([bar(1.1, 1.1, 1.1, 1.1), bar(1.1, 1.105, 1.099, 1.1045)]);
    a.placeOrder({ side: 'buy', kind: 'market', lots: 1, sl: 1.0981, tp: 1.1041 });
    const b = new ReplayEngine(a.candles, a.cfg, JSON.parse(JSON.stringify(a.snapshot())));
    b.step();
    expect(b.closed[0].pnl).toBeCloseTo(400, 6);
    expect(a.closed).toHaveLength(0);
  });
});
