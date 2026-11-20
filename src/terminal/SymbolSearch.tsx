import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../state/AppContext';
import type { DatasetMeta } from '../store/db';
import { INSTRUMENTS, SYMBOL_INFO, displaySymbol, symbolFromTradingView } from '../core/instruments';
import { formatDate, tfLabel } from '../core/time';
import { Monogram, canonical } from './Watchlist';
import { IClose, ISearch } from './toolIcons';

/** Symbol search: your candle data first, then markets you can get data for. */
export function SymbolSearch({ open, onClose, onPickDataset, onPickSymbol }: { open: boolean; onClose(): void; onPickDataset(d: DatasetMeta): void; onPickSymbol(symbol: string): void }) {
  const { datasets, settings } = useApp();
  const [q, setQ] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    setQ('');
    setTimeout(() => input.current?.focus(), 0);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const match = (s: string) => {
    const n = q.trim().toLowerCase();
    if (!n) return true;
    const info = SYMBOL_INFO[s];
    return s.toLowerCase().includes(n) || displaySymbol(s).toLowerCase().includes(n) || (info?.description.toLowerCase().includes(n) ?? false);
  };
  const withData = useMemo(() => [...datasets].sort((a, b) => canonical(a.symbol).localeCompare(canonical(b.symbol)) || a.tfSec - b.tfSec), [datasets]);
  const have = new Set(datasets.map((d) => canonical(d.symbol)));
  const others = useMemo(() => {
    const fromWatch = settings.watchlist.map((w) => symbolFromTradingView(w.tv));
    const all = [...fromWatch, ...INSTRUMENTS.map((i) => i.symbol)];
    return [...new Set(all)].filter((s) => !have.has(s));
  }, [settings.watchlist, datasets]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;
  const dataRows = withData.filter((d) => match(canonical(d.symbol)));
  const otherRows = others.filter(match);
  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center p-4 pt-[10vh]" role="dialog" aria-modal="true" aria-label="Symbol search">
      <div className="absolute inset-0 bg-scrim" onClick={onClose} />
      <div className="relative flex max-h-[75vh] w-full max-w-[620px] flex-col overflow-hidden rounded-[var(--radius-panel)] border border-ink-600 bg-ink-900 shadow-2xl">
        <div className="flex items-center gap-2 border-b border-ink-700 px-3">
          <ISearch size={18} className="text-fg-3" />
          <input ref={input} className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-fg-3" placeholder="Search a symbol, for example XAUUSD or Nasdaq" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search symbols" />
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-ctl)] text-fg-2 hover:bg-ink-850" aria-label="Close">
            <IClose size={16} />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto py-1">
          {dataRows.length > 0 && <div className="px-4 pb-1 pt-2 text-[12px] text-fg-3">Your candle data</div>}
          {dataRows.map((d) => {
            const s = canonical(d.symbol);
            return (
              <button key={d.id} type="button" onClick={() => onPickDataset(d)} className="flex w-full items-center gap-3 px-4 py-2 text-left transition hover:bg-ink-850">
                <Monogram symbol={s} size={24} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-semibold">
                    {displaySymbol(s)} <span className="font-normal text-fg-2">{tfLabel(d.tfSec)}</span>
                  </span>
                  <span className="block truncate text-[12px] text-fg-3">{SYMBOL_INFO[s]?.description ?? d.name}</span>
                </span>
                <span className="shrink-0 text-right text-[12px] text-fg-3">
                  {formatDate(d.start, settings.timezone)} to {formatDate(d.end, settings.timezone)}
                  <span className="block">{d.builtIn ? 'Sample' : d.sync ? 'Downloaded' : 'Imported'}</span>
                </span>
              </button>
            );
          })}
          {otherRows.length > 0 && <div className="px-4 pb-1 pt-3 text-[12px] text-fg-3">No candles yet: pick one to download or import</div>}
          {otherRows.map((s) => (
            <button key={s} type="button" onClick={() => onPickSymbol(s)} className="flex w-full items-center gap-3 px-4 py-2 text-left transition hover:bg-ink-850">
              <Monogram symbol={s} size={24} />
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold">{displaySymbol(s)}</span>
                <span className="block truncate text-[12px] text-fg-3">{SYMBOL_INFO[s]?.description ?? 'Custom market'}</span>
              </span>
              <span className="shrink-0 text-[12px] text-fg-3">Get data</span>
            </button>
          ))}
          {!dataRows.length && !otherRows.length && <p className="px-4 py-6 text-[13px] text-fg-3">Nothing matches "{q}". Import a CSV on the Data page to add any market.</p>}
        </div>
      </div>
    </div>
  );
}
