import { describe, expect, it } from 'vitest';
import { csvToTrades, TEMPLATE_CSV, tradesToCsv } from '../journal-csv';
import { generateSampleJournal } from '../sample-journal';
import { computeStats } from '../../core/stats';

const ctx = { accountCurrency: 'USD', usdValue: { USD: 1, JPY: 0.0067, GBP: 1.3 } };

describe('journal CSV', () => {
  it('imports the template and reads times in the user time zone', () => {
    const { trades, skipped } = csvToTrades(TEMPLATE_CSV, ctx, 'Asia/Kolkata');
    expect(skipped).toBe(0);
    expect(trades).toHaveLength(1);
    const t = trades[0];
    expect(t.symbol).toBe('EURUSD');
    expect(t.entryTime).toBe(Date.parse('2025-03-04T02:45:00Z') / 1000);
    expect(t.pips).toBeCloseTo(36, 6);
    expect(t.rMultiple).toBeCloseTo(2, 6);
    expect(t.pnl).toBeCloseTo(0.0036 * 100_000 * 0.5 - 3.5, 6);
    expect(t.setup).toBe('London breakout');
  });

  it('round-trips an export', () => {
    const original = generateSampleJournal(ctx, Date.parse('2025-06-01T00:00:00Z') / 1000).slice(0, 20);
    const back = csvToTrades(tradesToCsv(original), ctx, 'UTC').trades;
    expect(back).toHaveLength(20);
    expect(back[3].entryTime).toBe(original[3].entryTime);
    expect(back[3].pnl).toBeCloseTo(original[3].pnl, 2);
    expect(back[3].mistakes).toEqual(original[3].mistakes);
  });

  it('accepts broker-style column names and skips broken rows', () => {
    const csv = 'Ticket,Symbol,Type,Open Time,Close Time,Volume,Open Price,Close Price,S/L,Profit,Commission,Swap\n' +
      '1001,XAUUSD.m,sell,2025-03-05 14:00:00Z,2025-03-05 15:00:00Z,0.1,2920.5,2910.5,2925.5,100,-0.7,0\n' +
      '1002,EURUSD,buy,,,0.1,,,,,,\n';
    const { trades, skipped } = csvToTrades(csv, ctx, 'UTC');
    expect(skipped).toBe(1);
    expect(trades[0]).toMatchObject({ symbol: 'XAUUSD', side: 'sell', pnl: 100, fees: 0.7, id: 'imp-1001' });
    expect(trades[0].rMultiple).toBeCloseTo(2, 6);
  });
});

describe('sample journal', () => {
  it('is deterministic and internally consistent', () => {
    const now = Date.parse('2025-06-01T00:00:00Z') / 1000;
    const a = generateSampleJournal(ctx, now);
    const b = generateSampleJournal(ctx, now);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(30);
    for (const t of a) {
      expect(t.exitTime).toBeGreaterThan(t.entryTime);
      if (t.rMultiple !== null) expect(Math.sign(t.rMultiple) === Math.sign(t.pips) || Math.abs(t.rMultiple) < 0.11).toBe(true);
    }
    expect(computeStats(a).trades).toBe(a.length);
  });
});
