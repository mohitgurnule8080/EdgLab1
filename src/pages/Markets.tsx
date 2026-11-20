import { useMemo, useRef, useState, type FormEvent } from 'react';
import { TIMEFRAMES, formatDate, tfLabel } from '../core/time';
import { useApp } from '../state/AppContext';
import { DEFAULT_WATCHLIST } from '../state/defaults';
import type { DatasetMeta, ProviderId } from '../store/db';
import { PROVIDERS } from '../market/providers';
import { useMarketSync } from '../market/useSync';
import { TickerTape, TradingViewChart, inSandboxHost } from '../components/TradingViewChart';
import { Button, Field, PageHeader, Panel, Segmented } from '../components/ui';
import { plural } from '../lib/format';

export function relativeTime(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
}

export function MarketsPage() {
  const { settings, updateSettings } = useApp();
  const list = settings.watchlist;
  const [symbol, setSymbol] = useState(list[0]?.tv ?? 'FX:EURUSD');
  const [editing, setEditing] = useState(false);
  const [newTv, setNewTv] = useState('');

  const add = (e: FormEvent) => {
    e.preventDefault();
    const tv = newTv.trim().toUpperCase();
    if (!tv) return;
    const label = tv.includes(':') ? tv.split(':')[1] : tv;
    if (!list.some((w) => w.tv === tv)) updateSettings({ watchlist: [...list, { tv, label }] });
    setNewTv('');
    setSymbol(tv);
  };

  return (
    <div>
      <PageHeader title="Markets" intro="Live prices and charts from TradingView, and candles you can pull straight into a backtest." />
      <TickerTape items={list} />
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="panel flex h-[640px] flex-col overflow-hidden" aria-label="Live chart">
          <div className="flex flex-wrap items-center gap-1.5 border-b border-ink-700 px-3 py-2">
            {list.map((w) => (
              <button
                key={w.tv}
                type="button"
                onClick={() => setSymbol(w.tv)}
                aria-pressed={symbol === w.tv}
                className={`h-8 rounded-[var(--radius-ctl)] px-2.5 text-[13px] transition type-data ${symbol === w.tv ? 'seg-on' : 'text-fg-2 hover:bg-ink-850 hover:text-fg'}`}
              >
                {w.label}
              </button>
            ))}
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setEditing((v) => !v)} aria-expanded={editing}>
              {editing ? 'Done' : 'Edit list'}
            </Button>
          </div>
          {editing && (
            <div className="flex flex-wrap items-center gap-2 border-b border-ink-700 bg-ink-950 px-3 py-2.5">
              {list.map((w) => (
                <span key={w.tv} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-ink-600 pl-3 pr-1 text-[13px]">
                  {w.label}
                  <span className="text-fg-3">{w.tv.split(':')[0]}</span>
                  <button type="button" className="flex h-6 w-6 items-center justify-center rounded-full text-fg-3 hover:bg-ink-800 hover:text-fg" onClick={() => updateSettings({ watchlist: list.filter((x) => x.tv !== w.tv) })} aria-label={`Remove ${w.label}`}>
                    ✕
                  </button>
                </span>
              ))}
              <form onSubmit={add} className="flex gap-1.5">
                <input className="field h-8 min-h-0 w-[200px] py-0 text-[13px]" placeholder="TradingView symbol, e.g. OANDA:XAUUSD" value={newTv} onChange={(e) => setNewTv(e.target.value)} aria-label="Add a TradingView symbol" />
                <Button size="sm" type="submit">
                  Add
                </Button>
              </form>
              <Button size="sm" variant="ghost" onClick={() => updateSettings({ watchlist: DEFAULT_WATCHLIST })}>
                Reset list
              </Button>
            </div>
          )}
          <div className="relative flex-1">
            <TradingViewChart symbol={symbol} watchlist={list.map((w) => w.tv)} tz={settings.timezone} />
          </div>
        </section>
        <SyncPanel />
      </div>
      <SyncedData />
    </div>
  );
}

const DAYS = [7, 30, 90, 180, 365, 730];

function SyncPanel() {
  const { settings, go, toast } = useApp();
  const { download } = useMarketSync();
  const [provider, setProvider] = useState<ProviderId>('binance');
  const info = PROVIDERS.find((p) => p.id === provider)!;
  const [remote, setRemote] = useState('BTCUSDT');
  const [tf, setTf] = useState(60);
  const [days, setDays] = useState(30);
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<DatasetMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const blocked = inSandboxHost();
  const needsKey = info.needsKey && !settings.apiKeys.twelvedata;

  const est = useMemo(() => {
    const perDay = 86_400 / tf;
    const bars = Math.round(days * perDay * (provider === 'twelvedata' ? 5 / 7 : 1));
    const capped = provider === 'twelvedata' ? Math.min(bars, 40_000) : Math.min(bars, 300_000);
    const calls = provider === 'binance' ? Math.ceil(capped / 1000) : Math.ceil(capped / 5000);
    return { bars, capped, calls };
  }, [tf, days, provider]);

  const switchProvider = (p: ProviderId) => {
    setProvider(p);
    setRemote(p === 'binance' ? 'BTCUSDT' : 'EUR/USD');
    setTf(p === 'binance' ? 60 : 900);
    setResult(null);
    setError(null);
  };

  const run = async () => {
    setError(null);
    setResult(null);
    setProgress(0);
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      const meta = await download({ provider, remote: remote.trim(), tfSec: tf, days }, { signal: ctl.signal, onProgress: setProgress });
      setResult(meta);
      toast(`Saved ${plural(meta.count, 'candle')} of ${meta.symbol} ${tfLabel(meta.tfSec)}`, 'success');
    } catch (e) {
      setError(ctl.signal.aborted ? 'Download stopped.' : (e as Error).message);
    } finally {
      setProgress(null);
      abort.current = null;
    }
  };

  return (
    <Panel title="Get candles for backtesting">
      <div className="space-y-3">
        <Segmented
          label="Data source"
          value={provider}
          onChange={switchProvider}
          options={PROVIDERS.map((p) => ({ value: p.id, label: p.name }))}
        />
        <p className="text-[13px] text-fg-2">{info.note}</p>
        <Field label="Symbol">
          <input className="field type-data" list={`examples-${provider}`} value={remote} onChange={(e) => setRemote(e.target.value.toUpperCase())} />
          <datalist id={`examples-${provider}`}>
            {info.examples.map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Timeframe">
            <select className="field" value={tf} onChange={(e) => setTf(Number(e.target.value))}>
              {TIMEFRAMES.filter((t) => info.timeframes.includes(t.sec)).map((t) => (
                <option key={t.sec} value={t.sec}>
                  {t.id}
                </option>
              ))}
            </select>
          </Field>
          <Field label="History">
            <select className="field" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {DAYS.map((d) => (
                <option key={d} value={d}>
                  {d < 365 ? `${d} days` : `${d / 365} year${d > 365 ? 's' : ''}`}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <p className="text-[12px] text-fg-3">
          About {est.capped.toLocaleString()} candles in {plural(est.calls, 'request')}
          {provider === 'twelvedata' ? ` of your 800 free daily requests` : ''}.
          {est.capped < est.bars ? ` That is the most one download can fetch; pick a higher timeframe for the full period.` : ''}
          {tf === 60 ? ' M1 gives the most accurate fills when you replay higher timeframes.' : ''}
        </p>
        {blocked ? (
          <p className="rounded-[var(--radius-ctl)] border border-ink-600 bg-ink-950 px-3 py-2 text-[13px] text-fg-2">
            Downloading needs EdgeLab running on your own computer or website; this preview page cannot contact Binance or Twelve Data.
          </p>
        ) : needsKey ? (
          <p className="rounded-[var(--radius-ctl)] border border-brass/40 bg-brass/10 px-3 py-2 text-[13px]">
            Twelve Data needs a free API key.{' '}
            <button type="button" className="text-brass-fg underline" onClick={() => go('settings')}>
              Add it in Settings
            </button>
            .
          </p>
        ) : null}
        {progress !== null ? (
          <div className="flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-850">
              <div className="h-full bg-brass transition-all" style={{ width: `${Math.min(100, (progress / Math.max(1, est.capped)) * 100)}%` }} />
            </div>
            <span className="text-[12px] text-fg-2 type-data">{progress.toLocaleString()}</span>
            <Button size="sm" variant="ghost" onClick={() => abort.current?.abort()}>
              Stop
            </Button>
          </div>
        ) : (
          <Button variant="primary" className="w-full" onClick={run} disabled={blocked || needsKey || !remote.trim()}>
            Download candles
          </Button>
        )}
        {error && <p role="alert" className="text-[13px] text-loss-fg">{error}</p>}
        {result && (
          <div className="rounded-[var(--radius-ctl)] border border-profit/40 bg-profit/10 px-3 py-2.5 text-[13px]">
            <p>
              Saved {plural(result.count, 'candle')} of {result.symbol} {tfLabel(result.tfSec)}, {formatDate(result.start, settings.timezone)} to {formatDate(result.end, settings.timezone)}.
            </p>
            <Button size="sm" className="mt-2" onClick={() => go('backtest', `d-${result.id}`)}>
              Open it on the chart
            </Button>
          </div>
        )}
      </div>
    </Panel>
  );
}

function SyncedData() {
  const { datasets, settings, go, toast } = useApp();
  const { update } = useMarketSync();
  const [busy, setBusy] = useState<string | null>(null);
  const synced = datasets.filter((d) => d.sync);
  const blocked = inSandboxHost();

  const run = async (list: DatasetMeta[]) => {
    for (const d of list) {
      setBusy(d.id);
      try {
        const added = await update(d);
        toast(added ? `${d.symbol} ${tfLabel(d.tfSec)}: added ${plural(added, 'candle')}` : `${d.symbol} ${tfLabel(d.tfSec)} is up to date`, added ? 'success' : 'info');
      } catch (e) {
        toast(`${d.symbol}: ${(e as Error).message}`, 'error');
        break;
      }
    }
    setBusy(null);
  };

  if (!synced.length) return null;
  return (
    <Panel
      title="Downloaded data"
      className="mt-4"
      bodyClass="p-0"
      actions={
        <Button size="sm" onClick={() => run(synced)} disabled={!!busy || blocked}>
          Update all
        </Button>
      }
    >
      <div className="overflow-x-auto">
        <table className="table-data">
          <thead>
            <tr>
              <th>Data</th>
              <th>Source</th>
              <th>From</th>
              <th>To</th>
              <th className="num">Candles</th>
              <th>Updated</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {synced.map((d) => (
              <tr key={d.id}>
                <td className="font-medium">
                  {d.symbol} {tfLabel(d.tfSec)}
                </td>
                <td className="text-fg-2">{d.format}</td>
                <td>{formatDate(d.start, settings.timezone)}</td>
                <td>{formatDate(d.end, settings.timezone)}</td>
                <td className="num">{d.count.toLocaleString()}</td>
                <td className="text-fg-2">{relativeTime(d.sync!.lastSync)}</td>
                <td className="num">
                  <div className="flex justify-end gap-1">
                    <Button size="sm" onClick={() => run([d])} disabled={!!busy || blocked}>
                      {busy === d.id ? 'Updating…' : 'Update'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => go('backtest', `d-${d.id}`)}>
                      Chart
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
