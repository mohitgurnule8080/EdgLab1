import { describe, expect, it } from 'vitest';
import { fetchBinance, fetchTwelveData, mergeCandles, localSymbol, ProviderError } from '../providers';

type Handler = (url: URL) => { status?: number; body: unknown } | 'network-error';

function fakeFetch(handler: Handler) {
  const calls: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.push(url.toString());
    const r = handler(url);
    if (r === 'network-error') throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { impl, calls };
}

// Binance kline rows: [openTime, open, high, low, close, volume, closeTime, ...]
function kline(openMs: number, tfMs: number, o: number) {
  return [openMs, String(o), String(o + 2), String(o - 1), String(o + 1), '12.5', openMs + tfMs - 1, '0', 10, '0', '0', '0'];
}

describe('Binance provider', () => {
  const t0 = Date.parse('2026-11-01T00:00:00Z');
  const tf = 60_000;

  it('pages through 1000-candle chunks and skips the forming candle', async () => {
    const total = 2500;
    const now = (t0 + total * tf) / 1000 + 30; // last candle is still forming
    const { impl, calls } = fakeFetch((url) => {
      const start = Number(url.searchParams.get('startTime'));
      const rows = [];
      for (let t = start; t < t0 + (total + 1) * tf && rows.length < 1000; t += tf) rows.push(kline(t, tf, 100 + (t - t0) / tf));
      return { body: rows };
    });
    const candles = await fetchBinance({ symbol: 'btcusdt', tfSec: 60, from: t0 / 1000, to: now, now, fetchImpl: impl });
    expect(calls.length).toBe(3);
    expect(calls[0]).toContain('symbol=BTCUSDT');
    expect(calls[0]).toContain('interval=1m');
    expect(candles).toHaveLength(total);
    expect(candles[0]).toEqual({ time: t0 / 1000, open: 100, high: 102, low: 99, close: 101, volume: 12.5 });
    expect(candles[candles.length - 1].time).toBe(t0 / 1000 + (total - 1) * 60);
  });

  it('falls back to the market-data host when the main one is unreachable', async () => {
    const now = (t0 + 10 * tf) / 1000;
    const { impl, calls } = fakeFetch((url) => (url.hostname === 'api.binance.com' ? 'network-error' : { body: [kline(t0, tf, 50)] }));
    const candles = await fetchBinance({ symbol: 'ETHUSDT', tfSec: 60, from: t0 / 1000, to: now, now, fetchImpl: impl });
    expect(candles).toHaveLength(1);
    expect(calls[1]).toContain('data-api.binance.vision');
  });

  it('explains bad symbols and rate limits', async () => {
    const bad = fakeFetch(() => ({ status: 400, body: { code: -1121, msg: 'Invalid symbol.' } }));
    await expect(fetchBinance({ symbol: 'XAUUSD', tfSec: 60, from: 0, to: 600, now: 600, fetchImpl: bad.impl })).rejects.toMatchObject({ kind: 'symbol' });
    const limited = fakeFetch(() => ({ status: 429, body: {} }));
    await expect(fetchBinance({ symbol: 'BTCUSDT', tfSec: 60, from: 0, to: 600, now: 600, fetchImpl: limited.impl })).rejects.toBeInstanceOf(ProviderError);
  });
});

describe('Twelve Data provider', () => {
  it('reads time_series values, sorts them and drops the forming bar', async () => {
    const { impl, calls } = fakeFetch(() => ({
      body: {
        meta: { symbol: 'EUR/USD', interval: '1h' },
        values: [
          { datetime: '2026-11-03 02:00:00', open: '1.1003', high: '1.1010', low: '1.0999', close: '1.1005' },
          { datetime: '2026-11-03 00:00:00', open: '1.1000', high: '1.1004', low: '1.0995', close: '1.1001' },
          { datetime: '2026-11-03 01:00:00', open: '1.1001', high: '1.1006', low: '1.0998', close: '1.1003' },
        ],
        status: 'ok',
      },
    }));
    const now = Date.parse('2026-11-03T02:30:00Z') / 1000;
    const candles = await fetchTwelveData({ symbol: 'EUR/USD', tfSec: 3600, from: now - 86_400, to: now, now, apiKey: 'k', fetchImpl: impl });
    expect(candles.map((c) => c.time)).toEqual([Date.parse('2026-11-03T00:00:00Z') / 1000, Date.parse('2026-11-03T01:00:00Z') / 1000]);
    expect(candles[0]).toMatchObject({ open: 1.1, close: 1.1001, volume: 0 });
    const u = new URL(calls[0]);
    expect(u.pathname).toBe('/time_series');
    expect(u.searchParams.get('interval')).toBe('1h');
    expect(u.searchParams.get('timezone')).toBe('UTC');
    expect(u.searchParams.get('symbol')).toBe('EUR/USD');
  });

  it('maps API errors to plain-language reasons', async () => {
    const cases: [number, string][] = [[429, 'rate-limit'], [401, 'auth'], [403, 'plan'], [400, 'symbol']];
    for (const [code, kind] of cases) {
      const { impl } = fakeFetch(() => ({ body: { code, message: 'nope', status: 'error' } }));
      await expect(fetchTwelveData({ symbol: 'EUR/USD', tfSec: 60, from: 0, to: 600, now: 600, apiKey: 'k', fetchImpl: impl })).rejects.toMatchObject({ kind });
    }
    await expect(fetchTwelveData({ symbol: 'EUR/USD', tfSec: 60, from: 0, to: 600, now: 600 })).rejects.toMatchObject({ kind: 'auth' });
  });

  it('treats "no data" as an empty result', async () => {
    const { impl } = fakeFetch(() => ({ body: { code: 400, message: 'No data is available on the specified dates.', status: 'error' } }));
    expect(await fetchTwelveData({ symbol: 'EUR/USD', tfSec: 60, from: 0, to: 600, now: 600, apiKey: 'k', fetchImpl: impl })).toEqual([]);
  });
});

describe('helpers', () => {
  it('merges new candles into a dataset without duplicates', () => {
    const a = [1, 2, 3].map((t) => ({ time: t, open: 1, high: 1, low: 1, close: 1, volume: 0 }));
    const b = [3, 4].map((t) => ({ time: t, open: 2, high: 2, low: 2, close: 2, volume: 0 }));
    const m = mergeCandles(a, b);
    expect(m.map((c) => c.time)).toEqual([1, 2, 3, 4]);
    expect(m[2].open).toBe(2);
    expect(localSymbol('EUR/USD')).toBe('EURUSD');
  });
});
