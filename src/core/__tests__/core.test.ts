import { describe, expect, it } from 'vitest';
import { parseCandleCsv, parseTimestamp } from '../csv';
import { buildAggregation, partialBar, visibleBars } from '../resample';
import { bucketStart, dateKey, fromLocalInput, sessionOf, toLocalInput } from '../time';
import { findInstrument, guessSymbolFromName } from '../instruments';
import { grossPnl, lotsForRisk, roundLots } from '../sizing';
import { breakdown, computeStats, equityCurve } from '../stats';
import type { Candle, TradeRecord } from '../types';

const utc = (s: string) => Date.parse(s) / 1000;
const USD = { accountCurrency: 'USD', usdValue: { USD: 1, GBP: 1.3, JPY: 0.0067 } };

describe('CSV import', () => {
  it('reads MetaTrader 5 exports and applies the broker offset', () => {
    const text = '<DATE>\t<TIME>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\t<TICKVOL>\t<VOL>\t<SPREAD>\n2024.01.02\t02:00:00\t1.10432\t1.10500\t1.10400\t1.10450\t1234\t0\t5\n2024.01.02\t02:01:00\t1.10450\t1.10470\t1.10440\t1.10460\t900\t0\t5\n';
    const r = parseCandleCsv(text, { tzOffsetHours: 2 });
    expect(r.format).toBe('MetaTrader 5');
    expect(r.candles).toHaveLength(2);
    expect(r.candles[0].time).toBe(utc('2024-01-02T00:00:00Z'));
    expect(r.candles[0].volume).toBe(1234);
    expect(r.timeframeSec).toBe(60);
  });

  it('reads MetaTrader 4 history exports without a header', () => {
    const r = parseCandleCsv('2024.01.02,00:00,1.10432,1.10500,1.10400,1.10450,1234\n2024.01.02,01:00,1.1045,1.1050,1.1040,1.1046,800\n');
    expect(r.format).toBe('MetaTrader 4');
    expect(r.timeframeSec).toBe(3600);
    expect(r.candles[1].close).toBe(1.1046);
  });

  it('reads Dukascopy millisecond timestamps', () => {
    const r = parseCandleCsv('timestamp,open,high,low,close,volume\n1704153600000,1.1,1.2,1.0,1.15,10\n1704153660000,1.15,1.16,1.14,1.15,4\n');
    expect(r.format).toBe('Dukascopy');
    expect(r.candles[0].time).toBe(utc('2024-01-02T00:00:00Z'));
  });

  it('reads Dukascopy web exports with day-first dates', () => {
    const r = parseCandleCsv('Gmt time,Open,High,Low,Close,Volume\n02.01.2024 00:00:00.000,1.1,1.2,1.0,1.15,10\n');
    expect(r.candles[0].time).toBe(utc('2024-01-02T00:00:00Z'));
  });

  it('converts HistData EST timestamps to UTC', () => {
    const r = parseCandleCsv('20240102 170000;1.104530;1.104560;1.104420;1.104440;0\n20240102 170100;1.104440;1.104500;1.104400;1.104480;0\n');
    expect(r.format).toBe('HistData (EST)');
    expect(r.candles[0].time).toBe(utc('2024-01-02T22:00:00Z'));
  });

  it('reads pandas / yfinance style files with an unnamed index column', () => {
    const r = parseCandleCsv(',Open,High,Low,Close,Volume\n2017-04-19 09:00:00,1.0716,1.0722,1.07083,1.07219,1413\n');
    expect(r.candles[0]).toEqual({ time: utc('2017-04-19T09:00:00Z'), open: 1.0716, high: 1.0722, low: 1.07083, close: 1.07219, volume: 1413 });
  });

  it('reads TradingView exports with unix seconds, sorts and de-duplicates', () => {
    const r = parseCandleCsv('time,open,high,low,close\n1704157200,2,3,1,2.5\n1704153600,1,2,0.5,1.5\n1704157200,2,3,1,2.6\n');
    expect(r.candles.map((c) => c.close)).toEqual([1.5, 2.6]);
    expect(r.duplicates).toBe(1);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('repairs highs and lows that do not contain open/close', () => {
    const r = parseCandleCsv('time,open,high,low,close\n1704153600,1.2,1.1,1.0,1.05\n');
    expect(r.candles[0].high).toBe(1.2);
  });

  it('parses timestamps with explicit offsets', () => {
    expect(parseTimestamp('2024-03-15T09:30:00+05:30')).toEqual([utc('2024-03-15T04:00:00Z'), true]);
    expect(parseTimestamp('not a date')).toBeNull();
  });
});

describe('resampling', () => {
  const base: Candle[] = Array.from({ length: 10 }, (_, i) => ({
    time: utc('2024-01-02T00:00:00Z') + i * 60,
    open: 1 + i,
    high: 1 + i + 0.5,
    low: 1 + i - 0.5,
    close: 1 + i + 0.2,
    volume: 1,
  }));

  it('aggregates M1 into M5 bars', () => {
    const agg = buildAggregation(base, 300);
    expect(agg.bars).toHaveLength(2);
    expect(agg.bars[0]).toMatchObject({ open: 1, high: 5.5, low: 0.5, close: 5.2, volume: 5 });
    expect(Array.from(agg.firstBase)).toEqual([0, 5]);
    expect(agg.groupOf[7]).toBe(1);
  });

  it('builds the forming bar without looking ahead', () => {
    const agg = buildAggregation(base, 300);
    const p = partialBar(base, agg, 6);
    expect(p).toMatchObject({ open: 6, high: 7.5, close: 7.2, volume: 2 });
    expect(visibleBars(base, agg, 6)).toHaveLength(2);
  });

  it('starts weekly bars on Monday', () => {
    const wed = utc('2024-01-03T10:00:00Z');
    expect(bucketStart(wed, 604_800)).toBe(utc('2024-01-01T00:00:00Z'));
  });
});

describe('time zones and sessions', () => {
  it('classifies sessions in New York time, including daylight saving', () => {
    expect(sessionOf(utc('2024-01-15T13:00:00Z'))).toBe('London–NY overlap'); // 08:00 EST
    expect(sessionOf(utc('2024-07-15T12:00:00Z'))).toBe('London–NY overlap'); // 08:00 EDT
    expect(sessionOf(utc('2024-07-15T06:00:00Z'))).toBe('Asia'); // 02:00 EDT
    expect(sessionOf(utc('2024-07-15T07:00:00Z'))).toBe('London'); // 03:00 EDT
    expect(sessionOf(utc('2024-07-15T17:00:00Z'))).toBe('New York'); // 13:00 EDT
    expect(sessionOf(utc('2024-07-15T21:30:00Z'))).toBe('Rollover'); // 17:30 EDT
  });

  it('converts local input values in India time', () => {
    const t = fromLocalInput('2024-03-15T09:30', 'Asia/Kolkata');
    expect(t).toBe(utc('2024-03-15T04:00:00Z'));
    expect(toLocalInput(t!, 'Asia/Kolkata')).toBe('2024-03-15T09:30');
    expect(dateKey(utc('2024-03-15T20:00:00Z'), 'Asia/Kolkata')).toBe('2024-03-16');
  });

  it('handles New York DST switch days', () => {
    expect(fromLocalInput('2024-03-10T12:00', 'America/New_York')).toBe(utc('2024-03-10T16:00:00Z'));
    expect(fromLocalInput('2024-03-09T12:00', 'America/New_York')).toBe(utc('2024-03-09T17:00:00Z'));
  });
});

describe('instruments and sizing', () => {
  it('normalises broker symbols and file names', () => {
    expect(findInstrument('eurusd.m')?.symbol).toBe('EURUSD');
    expect(findInstrument('XAUUSD+')?.symbol).toBe('XAUUSD');
    expect(guessSymbolFromName('gbpjpy_m1_2024.csv')).toBe('GBPJPY');
  });

  it('sizes a position from risk percent', () => {
    const r = lotsForRisk({ inst: findInstrument('EURUSD')!, ctx: USD, balance: 10_000, riskPct: 1, entry: 1.1, sl: 1.098 });
    expect(r.lots).toBe(0.5);
    expect(r.riskAmount).toBeCloseTo(100, 6);
    expect(r.slPips).toBeCloseTo(20, 6);
  });

  it('counts commission as risk and rounds down', () => {
    const r = lotsForRisk({ inst: findInstrument('EURUSD')!, ctx: USD, balance: 10_000, riskPct: 1, entry: 1.1, sl: 1.098, commissionPerLot: 7 });
    expect(r.lots).toBe(0.48);
    expect(r.riskAmount).toBeLessThanOrEqual(100);
  });

  it('converts P&L of USD-base and cross pairs', () => {
    expect(grossPnl(findInstrument('USDJPY')!, 'buy', 150, 151, 1, USD)).toBeCloseTo(100_000 / 151, 6);
    expect(grossPnl(findInstrument('EURGBP')!, 'sell', 0.86, 0.85, 1, USD)).toBeCloseTo(1000 * 1.3, 6);
    expect(grossPnl(findInstrument('XAUUSD')!, 'buy', 2000, 2010, 0.1, USD)).toBeCloseTo(100, 6);
  });

  it('rounds lots to the step', () => {
    const inr = findInstrument('USDINR')!;
    expect(roundLots(inr, 3.9)).toBe(3);
    expect(roundLots(findInstrument('EURUSD')!, 0.129999)).toBe(0.12);
  });
});

function trade(pnl: number, r: number | null, i: number, extra: Partial<TradeRecord> = {}): TradeRecord {
  const entry = utc('2024-01-02T08:00:00Z') + i * 86_400;
  return {
    id: String(i),
    source: 'live',
    symbol: 'EURUSD',
    side: 'buy',
    entryTime: entry,
    exitTime: entry + 3600,
    entryPrice: 1.1,
    exitPrice: 1.1,
    lots: 1,
    pnl,
    fees: 0,
    rMultiple: r,
    pips: 0,
    setup: 'A',
    tags: [],
    mistakes: [],
    emotion: '',
    rating: 0,
    notes: '',
    screenshot: '',
    createdAt: 0,
    updatedAt: 0,
    ...extra,
  };
}

describe('statistics', () => {
  const trades = [trade(200, 2, 0), trade(-100, -1, 1), trade(-100, -1, 2), trade(300, 3, 3), trade(0, 0, 4)];

  it('computes the core metrics', () => {
    const s = computeStats(trades, 10_000);
    expect(s.trades).toBe(5);
    expect(s.wins).toBe(2);
    expect(s.losses).toBe(2);
    expect(s.breakeven).toBe(1);
    expect(s.winRate).toBeCloseTo(0.4, 10);
    expect(s.netPnl).toBe(300);
    expect(s.profitFactor).toBeCloseTo(2.5, 10);
    expect(s.expectancy).toBeCloseTo(60, 10);
    expect(s.avgR).toBeCloseTo(0.6, 10);
    expect(s.maxDrawdown).toBe(200);
    expect(s.maxDrawdownR).toBe(2);
    expect(s.maxDrawdownPct).toBeCloseTo(200 / 10_200, 10);
    expect(s.maxConsecLosses).toBe(2);
    expect(s.payoff).toBeCloseTo(2.5, 10);
    expect(s.sqn).not.toBeNull();
  });

  it('reports infinite profit factor without losses and handles no trades', () => {
    expect(computeStats([trade(50, 1, 0)]).profitFactor).toBe(Infinity);
    expect(computeStats([]).trades).toBe(0);
  });

  it('builds equity curves in exit order', () => {
    const curve = equityCurve([trades[1], trades[0]]);
    expect(curve.map((p) => p.pnl)).toEqual([0, 200, 100]);
  });

  it('breaks down by multi-valued keys', () => {
    const rows = breakdown(
      [trade(-100, -1, 0, { mistakes: ['FOMO', 'Moved SL'] }), trade(-50, -0.5, 1, { mistakes: ['FOMO'] }), trade(100, 1, 2)],
      (t) => t.mistakes,
    );
    expect(rows.map((r) => [r.key, r.stats.trades, r.stats.netPnl])).toEqual([
      ['FOMO', 2, -150],
      ['Moved SL', 1, -100],
    ]);
  });
});
