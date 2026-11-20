import { describe, expect, it } from 'vitest';
import { CloudStore, mergeRecords } from '../cloud';
import type { TradeRecord } from '../../core/types';
import { DEFAULT_SETTINGS } from '../../state/defaults';

/** In-memory stand-in for the host's document store (same path rules: even = doc, odd = collection). */
function fakeDb(opts: { readOnly?: boolean } = {}) {
  const docs = new Map<string, Record<string, unknown>>();
  let writes = 0;
  const docRef = (path: string): any => ({
    path,
    async get() {
      const d = docs.get(path);
      return { id: path.split('/').pop(), exists: !!d, data: () => (d ? structuredClone(d) : undefined) };
    },
    async set(data: Record<string, unknown>) {
      if (opts.readOnly) throw { code: 'invalid_argument', message: 'no' };
      writes++;
      docs.set(path, structuredClone(data));
    },
    async delete() {
      writes++;
      docs.delete(path);
    },
    collection: (sub: string) => colRef(`${path}/${sub}`),
  });
  const colRef = (path: string): any => ({
    path,
    doc: (id: string) => docRef(`${path}/${id}`),
    async get() {
      const depth = path.split('/').length + 1;
      const list = [...docs.entries()]
        .filter(([p]) => p.startsWith(path + '/') && p.split('/').length === depth)
        .map(([p, d]) => ({ id: p.split('/').pop(), exists: true, data: () => structuredClone(d) }));
      return { docs: list };
    },
  });
  return { db: { doc: docRef }, docs, writes: () => writes };
}

const settle = () => new Promise((r) => setTimeout(r, 5));

function t(id: string, entry: string, updatedAt = 100): TradeRecord {
  const e = Date.parse(entry) / 1000;
  return {
    id, source: 'live', symbol: 'EURUSD', side: 'buy', entryTime: e, exitTime: e + 600, entryPrice: 1.1, exitPrice: 1.101, lots: 1,
    pnl: 100, fees: 0, rMultiple: 1, pips: 10, setup: '', tags: [], mistakes: [], emotion: '', rating: 0, notes: '', screenshot: '',
    createdAt: updatedAt, updatedAt,
  };
}

describe('cloud mirror', () => {
  it('stores trades in month documents and reads them back on another device', async () => {
    const f = fakeDb();
    const a = new CloudStore(f.db, 'u1');
    await a.load();
    a.syncTrades([t('1', '2025-03-04T08:00:00Z'), t('2', '2025-03-20T08:00:00Z'), t('3', '2025-04-02T08:00:00Z')]);
    a.syncSettings({ ...DEFAULT_SETTINGS, accountSize: 5000 });
    await settle();
    expect([...f.docs.keys()].sort()).toEqual([
      'data/users/u1/edgelab',
      'data/users/u1/edgelab/trades/2025-03.0',
      'data/users/u1/edgelab/trades/2025-04.0',
    ]);
    const b = new CloudStore(f.db, 'u1');
    const snap = await b.load();
    expect(snap.exists).toBe(true);
    expect(snap.trades.map((x) => x.id).sort()).toEqual(['1', '2', '3']);
    expect(snap.settings?.accountSize).toBe(5000);
  });

  it('writes only the documents that changed', async () => {
    const f = fakeDb();
    const a = new CloudStore(f.db, 'u1');
    await a.load();
    const list = [t('1', '2025-03-04T08:00:00Z'), t('2', '2025-04-02T08:00:00Z')];
    a.syncTrades(list);
    await settle();
    const before = f.writes();
    a.syncTrades([...list]);
    await settle();
    expect(f.writes()).toBe(before);
    a.syncTrades([{ ...list[0], notes: 'edited', updatedAt: 200 }, list[1]]);
    await settle();
    expect(f.writes()).toBe(before + 1);
  });

  it('keeps deleted trades deleted when another device still has them', async () => {
    const f = fakeDb();
    const a = new CloudStore(f.db, 'u1');
    await a.load();
    a.syncTrades([t('1', '2025-03-04T08:00:00Z'), t('2', '2025-03-05T08:00:00Z')]);
    await settle();
    a.syncTrades([t('1', '2025-03-04T08:00:00Z')]);
    await settle();
    const b = new CloudStore(f.db, 'u1');
    const snap = await b.load();
    const merged = mergeRecords([t('1', '2025-03-04T08:00:00Z'), t('2', '2025-03-05T08:00:00Z')], snap.trades, snap.tradeTombs);
    expect(merged.map((x) => x.id)).toEqual(['1']);
  });

  it('lets the newer edit win when merging', () => {
    const merged = mergeRecords([{ ...t('1', '2025-03-04T08:00:00Z', 300), notes: 'local' }], [{ ...t('1', '2025-03-04T08:00:00Z', 200), notes: 'remote' }], {});
    expect(merged[0].notes).toBe('local');
  });

  it('falls back to read-only when the viewer may not write', async () => {
    const f = fakeDb({ readOnly: true });
    const a = new CloudStore(f.db, 'u1');
    const seen: string[] = [];
    a.onStatus = (s) => seen.push(s);
    await a.load();
    a.syncTrades([t('1', '2025-03-04T08:00:00Z')]);
    await settle();
    expect(a.status).toBe('readonly');
    expect(seen).toContain('readonly');
  });
});
