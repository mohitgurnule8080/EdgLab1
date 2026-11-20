import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../state/AppContext';
import type { DatasetMeta, WatchItem } from '../store/db';
import { SYMBOL_ALIASES, SYMBOL_INFO, displaySymbol, normaliseSymbol, symbolFromTradingView, type AssetClass } from '../core/instruments';
import { formatDate, formatDuration, tfLabel } from '../core/time';
import { isWeekend, sessionStatus, useNow } from '../lib/sessions';
import { plural } from '../lib/format';
import { PROVIDERS, providerFor } from '../market/providers';
import { useMarketSync } from '../market/useSync';
import { Button } from '../components/ui';

export interface Quote {
  last: number;
  chg: number;
  chgPct: number;
  time: number;
  digits: number;
}

export const canonical = (s: string) => {
  const n = normaliseSymbol(s);
  return SYMBOL_ALIASES[n] ?? n;
};

/** The dataset to open for a symbol: most recent data first, then the finest timeframe. */
export function bestDataset(datasets: DatasetMeta[], symbol: string): DatasetMeta | undefined {
  return datasets.filter((d) => canonical(d.symbol) === symbol).sort((a, b) => b.end - a.end || a.tfSec - b.tfSec)[0];
}

const CLASS_COLOR: Record<AssetClass, string> = {
  forex: 'var(--session-asia)',
  metal: 'var(--session-london)',
  crypto: 'var(--session-london)',
  index: 'var(--session-ny)',
  energy: 'var(--color-fg-3)',
  futures: 'var(--session-ny)',
};

/** A plain monogram for a market (no logos): two letters on the asset-class colour. */
export function Monogram({ symbol, size = 20 }: { symbol: string; size?: number }) {
  const info = SYMBOL_INFO[symbol];
  const kind = info?.kind ?? 'forex';
  const letters = kind === 'forex' ? symbol.slice(0, 1) + symbol.slice(3, 4) : displaySymbol(symbol).replace(/[^A-Z]/g, '').slice(0, 2);
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.42, background: CLASS_COLOR[kind], letterSpacing: '-0.02em' }}
      aria-hidden
    >
      {letters}
    </span>
  );
}

function useQuotes(symbols: string[]) {
  const { datasets, loadCandles, instrumentFor } = useApp();
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const key = datasets.map((d) => `${d.id}:${d.end}`).join('|') + symbols.join(',');
  useEffect(() => {
    let alive = true;
    (async () => {
      const out: Record<string, Quote> = {};
      for (const s of symbols) {
        const ds = bestDataset(datasets, s);
        if (!ds) continue;
        try {
          const c = await loadCandles(ds.id);
          if (!c.length) continue;
          const last = c[c.length - 1];
          // Change against the close about 24 hours earlier (the previous candle for daily data).
          let i = c.length - 2;
          while (i > 0 && c[i].time > last.time - 86_400) i--;
          const ref = c[Math.max(0, i)].close;
          out[s] = { last: last.close, chg: last.close - ref, chgPct: ref ? ((last.close - ref) / ref) * 100 : 0, time: last.time, digits: instrumentFor(s).digits };
        } catch {
          /* skip */
        }
      }
      if (alive) setQuotes(out);
    })();
    return () => {
      alive = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return quotes;
}

export interface WatchRow {
  item: WatchItem;
  symbol: string;
  dataset?: DatasetMeta;
}

/** Watchlist with last price and change, then details and data options for the selected market. */
export function Watchlist({ current, onOpen }: { current: string; onOpen(symbol: string, dataset?: DatasetMeta): void }) {
  const { settings, datasets } = useApp();
  const rows: WatchRow[] = useMemo(() => settings.watchlist.map((item) => {
    const symbol = symbolFromTradingView(item.tv);
    return { item, symbol, dataset: bestDataset(datasets, symbol) };
  }), [settings.watchlist, datasets]);
  const quotes = useQuotes(rows.map((r) => r.symbol));
  const [focus, setFocus] = useState<string>(current);
  useEffect(() => setFocus(current), [current]);
  const focusRow = rows.find((r) => r.symbol === focus) ?? { item: { tv: focus, label: displaySymbol(focus) }, symbol: focus, dataset: bestDataset(datasets, focus) };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between px-3 pb-1 pt-2.5">
        <h2 className="text-[13px] font-semibold">Watchlist</h2>
        <span className="text-[12px] text-fg-3">{plural(rows.length, 'market')}</span>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_74px_54px_56px] gap-x-1 border-b border-ink-700 px-3 pb-1.5 text-[11px] text-fg-3">
        <span>Symbol</span>
        <span className="text-right">Last</span>
        <span className="text-right">Chg</span>
        <span className="text-right">Chg%</span>
      </div>
      <ul className="min-h-0 shrink overflow-y-auto py-1" aria-label="Watchlist">
        {rows.map((r) => {
          const q = quotes[r.symbol];
          const active = r.symbol === focus;
          const tone = q ? (q.chg >= 0 ? 'text-profit-fg' : 'text-loss-fg') : 'text-fg-3';
          return (
            <li key={r.item.tv}>
              <button
                type="button"
                onClick={() => {
                  setFocus(r.symbol);
                  if (r.dataset) onOpen(r.symbol, r.dataset);
                }}
                aria-current={r.symbol === current ? 'true' : undefined}
                className={`relative grid w-full grid-cols-[minmax(0,1fr)_74px_54px_56px] items-center gap-x-1 px-3 py-[7px] text-left text-[13px] transition ${active ? 'bg-ink-850' : 'hover:bg-ink-850/70'}`}
              >
                {r.symbol === current && <span className="absolute inset-y-1 left-0 w-[3px] rounded-r bg-brass" aria-hidden />}
                <span className="flex min-w-0 items-center gap-2">
                  <Monogram symbol={r.symbol} size={18} />
                  <span className="truncate font-medium">{r.item.label}</span>
                </span>
                <span className="type-data text-right">{q ? q.last.toFixed(q.digits) : <span className="text-[12px] text-fg-3">no data</span>}</span>
                <span className={`type-data text-right ${tone}`}>{q ? `${q.chg >= 0 ? '+' : '−'}${Math.abs(q.chg).toFixed(Math.min(q.digits, 5))}` : ''}</span>
                <span className={`type-data text-right ${tone}`}>{q ? `${q.chgPct >= 0 ? '+' : '−'}${Math.abs(q.chgPct).toFixed(2)}%` : ''}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-ink-700">
        <SymbolDetails row={focusRow} quote={quotes[focusRow.symbol]} onOpen={onOpen} isOpen={focusRow.symbol === current} />
      </div>
    </div>
  );
}

function SymbolDetails({ row, quote, onOpen, isOpen }: { row: WatchRow; quote?: Quote; onOpen(symbol: string, d?: DatasetMeta): void; isOpen: boolean }) {
  const { datasets, settings, go } = useApp();
  const now = useNow(60_000);
  const info = SYMBOL_INFO[row.symbol];
  const all = datasets.filter((d) => canonical(d.symbol) === row.symbol);
  const exchange = row.item.tv.includes(':') ? row.item.tv.slice(0, row.item.tv.indexOf(':')).replace(/_/g, ' ') : '';
  const st = sessionStatus(now);
  const crypto = info?.kind === 'crypto';
  const open = crypto || !isWeekend(now);
  return (
    <div className="space-y-3 p-3">
      <div className="flex items-start gap-2.5">
        <Monogram symbol={row.symbol} size={28} />
        <div className="min-w-0">
          <div className="text-[15px] font-semibold leading-tight">{row.item.label}</div>
          <div className="text-[12px] text-fg-2">{info?.description ?? 'Custom market'}</div>
          {exchange && <div className="text-[11px] text-fg-3">{exchange} on TradingView</div>}
        </div>
      </div>
      {quote && (
        <div>
          <div className="type-data text-[24px] font-semibold leading-tight">{quote.last.toFixed(quote.digits)}</div>
          <div className={`type-data text-[13px] ${quote.chg >= 0 ? 'text-profit-fg' : 'text-loss-fg'}`}>
            {quote.chg >= 0 ? '+' : '−'}
            {Math.abs(quote.chg).toFixed(quote.digits)} ({quote.chgPct >= 0 ? '+' : '−'}
            {Math.abs(quote.chgPct).toFixed(2)}%)
          </div>
          <div className="mt-0.5 text-[11px] text-fg-3">Last candle in your data: {formatDate(quote.time, settings.timezone)}</div>
        </div>
      )}
      <div className="flex items-center gap-1.5 text-[12px]">
        <span className={`h-2 w-2 rounded-full ${open ? 'bg-profit' : 'bg-fg-3'}`} aria-hidden />
        <span className="text-fg-2">{crypto ? 'Crypto trades around the clock' : open ? `Market open, ${st.current === 'London–NY overlap' ? 'London and New York' : st.current} session` : `Market closed, opens in ${formatDuration(st.left)}`}</span>
      </div>

      {all.length > 0 ? (
        <div className="space-y-1.5">
          <div className="text-[12px] text-fg-3">Your candle data</div>
          {all.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => onOpen(row.symbol, d)}
              className="flex w-full items-center justify-between gap-2 rounded-[var(--radius-ctl)] border border-ink-700 px-2.5 py-1.5 text-left text-[12px] transition hover:border-ink-600 hover:bg-ink-850"
            >
              <span className="min-w-0">
                <span className="font-medium">{tfLabel(d.tfSec)}</span> <span className="text-fg-2">{d.builtIn ? 'sample' : d.sync ? PROVIDERS.find((p) => p.id === d.sync!.provider)?.name : 'imported'}</span>
                <span className="block truncate text-fg-3">
                  {formatDate(d.start, settings.timezone)} to {formatDate(d.end, settings.timezone)}
                </span>
              </span>
              <span className="type-data shrink-0 text-fg-3">{d.count.toLocaleString('en-US')}</span>
            </button>
          ))}
          {!isOpen && all[0] && (
            <Button size="sm" variant="primary" className="w-full" onClick={() => onOpen(row.symbol, all[0])}>
              Open {row.item.label} chart
            </Button>
          )}
        </div>
      ) : (
        <GetData symbol={row.symbol} label={row.item.label} onDone={(d) => onOpen(row.symbol, d)} />
      )}
      <button type="button" className="text-[12px] text-fg-3 underline-offset-2 hover:text-fg hover:underline" onClick={() => go('data')}>
        Import a CSV from MetaTrader or TradingView
      </button>
    </div>
  );
}

const HISTORY: { label: string; days: number }[] = [
  { label: '1 month', days: 30 },
  { label: '3 months', days: 90 },
  { label: '1 year', days: 365 },
];

function GetData({ symbol, label, onDone }: { symbol: string; label: string; onDone(d: DatasetMeta): void }) {
  const { settings, toast, go } = useApp();
  const { download } = useMarketSync();
  const src = providerFor(symbol);
  const [tf, setTf] = useState(src?.provider === 'binance' ? 900 : 3600);
  const [days, setDays] = useState(90);
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState(0);
  const needsKey = src?.provider === 'twelvedata' && !settings.apiKeys.twelvedata;
  const providerName = src ? PROVIDERS.find((p) => p.id === src.provider)?.name : '';

  const run = async () => {
    if (!src) return;
    setBusy(true);
    setCount(0);
    try {
      const d = await download({ provider: src.provider, remote: src.remote, tfSec: tf, days }, { onProgress: setCount });
      toast(`${label}: ${plural(d.count, 'candle')} saved`, 'success');
      onDone(d);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!src)
    return (
      <div className="rounded-[var(--radius-ctl)] bg-ink-850 p-3 text-[12px] text-fg-2">
        No free source serves {label} candles to the browser. Export them from TradingView (chart menu, Export chart data) or from MetaTrader, then import the CSV.
      </div>
    );
  return (
    <div className="space-y-2 rounded-[var(--radius-ctl)] bg-ink-850 p-3 text-[12px]">
      <div className="text-fg-2">
        No candles for {label} yet. Download them from {providerName}
        {src.provider === 'binance' ? ' (free, no key).' : ' with your free API key.'}
      </div>
      {needsKey ? (
        <Button size="sm" onClick={() => go('settings')}>
          Add a Twelve Data key in Settings
        </Button>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <select className="field h-8 min-h-0 py-0 text-[12px]" value={tf} onChange={(e) => setTf(Number(e.target.value))} aria-label="Timeframe">
              {[60, 300, 900, 3600, 14_400, 86_400].map((s) => (
                <option key={s} value={s}>
                  {tfLabel(s)}
                </option>
              ))}
            </select>
            <select className="field h-8 min-h-0 py-0 text-[12px]" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="History">
              {HISTORY.map((h) => (
                <option key={h.days} value={h.days}>
                  {h.label}
                </option>
              ))}
            </select>
          </div>
          <Button size="sm" variant="primary" className="w-full" onClick={run} disabled={busy}>
            {busy ? `Downloading… ${count ? count.toLocaleString('en-US') : ''}` : `Download ${label} candles`}
          </Button>
        </>
      )}
    </div>
  );
}
