import { useCallback } from 'react';
import type { Instrument } from '../core/types';
import { tfLabel } from '../core/time';
import { customInstrument } from '../core/instruments';
import { useApp } from '../state/AppContext';
import type { DatasetMeta, ProviderId } from '../store/db';
import { fetchCandles, localSymbol, mergeCandles, PROVIDERS, ProviderError } from './providers';

export const syncedDatasetId = (provider: ProviderId, remote: string, tfSec: number) => `sync-${provider}-${localSymbol(remote)}-${tfSec}`;

const FIAT = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD', 'INR', 'SGD', 'HKD', 'ZAR', 'MXN', 'NOK', 'SEK', 'TRY'];

/** Sensible contract specs for a symbol EdgeLab doesn't know yet, from its name and price. */
export function guessInstrument(symbol: string, price: number): Instrument {
  const base = symbol.slice(0, 3);
  const quote = symbol.slice(3);
  const isFx = symbol.length === 6 && FIAT.includes(base) && FIAT.includes(quote);
  if (isFx) return customInstrument(symbol, quote === 'JPY' ? 0.01 : 0.0001, 100_000, quote === 'JPY' ? 3 : 5);
  // Crypto and anything else: 1 lot = 1 unit, precision from the price.
  const digits = price >= 1000 ? 2 : price >= 10 ? 3 : price >= 0.1 ? 5 : 7;
  const pipSize = price >= 1000 ? 1 : price >= 10 ? 0.01 : price >= 0.1 ? 0.0001 : 0.000001;
  return {
    symbol,
    base: symbol.replace(/(USDT|USDC|USD|BTC|ETH)$/, '') || base,
    quote: (/(USDT|USDC|USD|BTC|ETH)$/.exec(symbol)?.[1] ?? 'USD').replace('USDC', 'USDT'),
    pipSize,
    contractSize: 1,
    digits,
    minLot: 0.001,
    lotStep: 0.001,
  };
}

export interface SyncOptions {
  signal?: AbortSignal;
  onProgress?(count: number): void;
}

/** Download candles from a provider into a backtest dataset, or top an existing one up. */
export function useMarketSync() {
  const { datasets, addDataset, loadCandles, settings, updateSettings, instruments } = useApp();

  const ensureInstrument = useCallback(
    (symbol: string, price: number) => {
      if (instruments.some((i) => i.symbol === symbol)) return;
      updateSettings({ instrumentOverrides: [...settings.instrumentOverrides.filter((i) => i.symbol !== symbol), guessInstrument(symbol, price)] });
    },
    [instruments, settings.instrumentOverrides, updateSettings],
  );

  const download = useCallback(
    async (spec: { provider: ProviderId; remote: string; tfSec: number; days: number }, opts: SyncOptions = {}): Promise<DatasetMeta> => {
      const now = Math.floor(Date.now() / 1000);
      const candles = await fetchCandles(spec.provider, {
        symbol: spec.remote,
        tfSec: spec.tfSec,
        from: now - spec.days * 86_400,
        to: now,
        apiKey: settings.apiKeys.twelvedata,
        maxBars: 300_000,
        signal: opts.signal,
        onProgress: opts.onProgress,
      });
      if (!candles.length) throw new ProviderError('other', 'No candles came back for that symbol and period. Markets may have been closed.');
      const id = syncedDatasetId(spec.provider, spec.remote, spec.tfSec);
      const existing = datasets.find((d) => d.id === id);
      const before = existing ? await loadCandles(id).catch(() => []) : [];
      const merged = mergeCandles(before, candles);
      const symbol = localSymbol(spec.remote);
      ensureInstrument(symbol, merged[merged.length - 1].close);
      const providerName = PROVIDERS.find((p) => p.id === spec.provider)?.name ?? spec.provider;
      const meta: DatasetMeta = {
        id,
        name: `${symbol} ${tfLabel(spec.tfSec)} from ${providerName}`,
        symbol,
        tfSec: spec.tfSec,
        count: merged.length,
        start: merged[0].time,
        end: merged[merged.length - 1].time,
        format: providerName,
        tzOffsetHours: 0,
        createdAt: existing?.createdAt ?? Date.now(),
        sync: { provider: spec.provider, remoteSymbol: spec.remote, lastSync: Date.now() },
      };
      await addDataset(meta, merged);
      return meta;
    },
    [datasets, loadCandles, addDataset, ensureInstrument, settings.apiKeys.twelvedata],
  );

  /** Fetch only the candles newer than the last one saved. Returns how many were added. */
  const update = useCallback(
    async (meta: DatasetMeta, opts: SyncOptions = {}): Promise<number> => {
      if (!meta.sync) return 0;
      const existing = await loadCandles(meta.id);
      const last = existing[existing.length - 1]?.time ?? meta.end;
      const now = Math.floor(Date.now() / 1000);
      if (now - last < meta.tfSec * 2) return 0;
      const candles = await fetchCandles(meta.sync.provider, {
        symbol: meta.sync.remoteSymbol,
        tfSec: meta.tfSec,
        from: last + meta.tfSec,
        to: now,
        apiKey: settings.apiKeys.twelvedata,
        maxBars: 300_000,
        signal: opts.signal,
        onProgress: opts.onProgress,
      });
      const merged = mergeCandles(existing, candles);
      await addDataset({ ...meta, count: merged.length, end: merged[merged.length - 1].time, sync: { ...meta.sync, lastSync: Date.now() } }, merged);
      return merged.length - existing.length;
    },
    [loadCandles, addDataset, settings.apiKeys.twelvedata],
  );

  return { download, update };
}
