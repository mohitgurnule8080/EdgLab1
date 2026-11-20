import { useMemo, useRef, useState } from 'react';
import { parseCandleCsv, type ParseResult } from '../core/csv';
import { customInstrument, guessSymbolFromName, normaliseSymbol } from '../core/instruments';
import { formatDate, formatDateTime, tfLabel } from '../core/time';
import { useApp } from '../state/AppContext';
import { Button, Field, PageHeader, Panel } from '../components/ui';
import { plural, uid } from '../lib/format';

const OFFSETS: { value: string; label: string }[] = [
  { value: 'auto', label: 'Detect from format' },
  { value: '0', label: 'UTC (Dukascopy, TradingView)' },
  { value: '2', label: 'UTC+2 (many MT5 brokers, winter)' },
  { value: '3', label: 'UTC+3 (many MT5 brokers, summer)' },
  { value: '1', label: 'UTC+1' },
  { value: '-5', label: 'UTC−5, no daylight saving (HistData)' },
  { value: '5.5', label: 'UTC+5:30 (India)' },
];

export function DataPage() {
  const { datasets, addDataset, deleteDataset, settings, instruments, updateSettings, toast, go, storageMode, confirm } = useApp();
  const tz = settings.timezone;
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [offset, setOffset] = useState('auto');
  const [symbol, setSymbol] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [custom, setCustom] = useState({ pipSize: '0.0001', contractSize: '100000', digits: '5' });

  const parsed = useMemo<{ ok: true; r: ParseResult } | { ok: false; error: string } | null>(() => {
    if (!file) return null;
    try {
      return { ok: true, r: parseCandleCsv(file.text, { tzOffsetHours: offset === 'auto' ? undefined : Number(offset) }) };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }, [file, offset]);

  const known = instruments.some((i) => i.symbol === normaliseSymbol(symbol));

  const pick = async (f: File) => {
    if (f.size > 200 * 1024 * 1024) {
      toast('That file is over 200 MB. Split it into smaller date ranges first.', 'error');
      return;
    }
    const text = await f.text();
    setFile({ name: f.name, text });
    setSymbol(guessSymbolFromName(f.name, instruments) ?? '');
    setName(f.name.replace(/\.(csv|txt)$/i, ''));
    setOffset('auto');
  };

  const save = async () => {
    if (!parsed?.ok) return;
    const sym = normaliseSymbol(symbol);
    if (!sym) {
      toast('Choose which pair this data is for.', 'error');
      return;
    }
    if (!known) {
      const inst = customInstrument(sym, Number(custom.pipSize) || 0.0001, Number(custom.contractSize) || 100_000, Math.max(0, Math.round(Number(custom.digits) || 5)));
      updateSettings({ instrumentOverrides: [...settings.instrumentOverrides.filter((i) => i.symbol !== sym), inst] });
    }
    setBusy(true);
    try {
      const r = parsed.r;
      const id = uid('d');
      await addDataset(
        {
          id,
          name: name.trim() || file?.name || sym,
          symbol: sym,
          tfSec: r.timeframeSec ?? 60,
          count: r.candles.length,
          start: r.candles[0].time,
          end: r.candles[r.candles.length - 1].time,
          format: r.format,
          tzOffsetHours: r.tzOffsetHours,
          createdAt: Date.now(),
        },
        r.candles,
      );
      toast(`Saved ${plural(r.candles.length, 'candle')} of ${sym}. Pick it when you start a backtest.`, 'success');
      setFile(null);
    } catch (e) {
      toast(`Could not save the data: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title="Data" intro="Candles you can replay. Files are read in your browser and stored on this device only." />
      {storageMode === 'memory' && (
        <p className="mb-4 rounded-[var(--radius-panel)] border border-loss/50 bg-loss/10 px-4 py-2.5">
          This browser is not letting EdgeLab save data, so imported candles disappear when you close the tab.
        </p>
      )}
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <Panel title="Import candles">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              const f = e.dataTransfer.files?.[0];
              if (f) void pick(f);
            }}
            className={`flex flex-col items-start gap-3 rounded-[var(--radius-panel)] border border-dashed p-5 transition ${drag ? 'border-brass bg-brass/10' : 'border-ink-600'}`}
          >
            <div>
              <div className="font-semibold">Drop a CSV file here</div>
              <div className="text-[13px] text-fg-2">MetaTrader 4 or 5 exports, Dukascopy, HistData, TradingView and most OHLC files are recognised automatically.</div>
            </div>
            <Button onClick={() => fileRef.current?.click()}>Choose file</Button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void pick(f);
                e.target.value = '';
              }}
            />
          </div>

          {file && parsed && !parsed.ok && <p className="mt-4 rounded-[var(--radius-ctl)] border border-loss/50 bg-loss/10 px-3 py-2 text-loss-fg">{parsed.error}</p>}

          {file && parsed?.ok && (
            <div className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-3 rounded-[var(--radius-ctl)] bg-ink-950 p-3 text-[13px] sm:grid-cols-4">
                <Info label="Format" value={parsed.r.format} />
                <Info label="Timeframe" value={parsed.r.timeframeSec ? tfLabel(parsed.r.timeframeSec) : 'Unknown'} />
                <Info label="Candles" value={parsed.r.candles.length.toLocaleString()} />
                <Info label="Range" value={`${formatDate(parsed.r.candles[0].time, tz)} to ${formatDate(parsed.r.candles[parsed.r.candles.length - 1].time, tz)}`} />
              </div>
              {parsed.r.warnings.map((w) => (
                <p key={w} className="text-[13px] text-fg-2">
                  {w}
                </p>
              ))}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Pair">
                  <input className="field" list="data-symbols" placeholder="EURUSD" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
                  <datalist id="data-symbols">
                    {instruments.map((i) => (
                      <option key={i.symbol} value={i.symbol} />
                    ))}
                  </datalist>
                </Field>
                <Field label="Time zone of the file" hint={`Applied: UTC${parsed.r.tzOffsetHours >= 0 ? '+' : '−'}${Math.abs(parsed.r.tzOffsetHours)}`}>
                  <select className="field" value={offset} onChange={(e) => setOffset(e.target.value)}>
                    {OFFSETS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              {symbol && !known && (
                <div className="grid grid-cols-3 gap-3 rounded-[var(--radius-ctl)] border border-ink-700 p-3">
                  <p className="col-span-3 text-[13px] text-fg-2">{normaliseSymbol(symbol)} is not built in. Tell EdgeLab how it is priced:</p>
                  <Field label="Pip size">
                    <input className="field type-data" value={custom.pipSize} onChange={(e) => setCustom({ ...custom, pipSize: e.target.value })} />
                  </Field>
                  <Field label="Units per lot">
                    <input className="field type-data" value={custom.contractSize} onChange={(e) => setCustom({ ...custom, contractSize: e.target.value })} />
                  </Field>
                  <Field label="Price decimals">
                    <input className="field type-data" value={custom.digits} onChange={(e) => setCustom({ ...custom, digits: e.target.value })} />
                  </Field>
                </div>
              )}
              <Field label="Name">
                <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <div className="overflow-x-auto rounded-[var(--radius-ctl)] border border-ink-700">
                <table className="table-data">
                  <thead>
                    <tr>
                      <th>Time ({tz})</th>
                      <th className="num">Open</th>
                      <th className="num">High</th>
                      <th className="num">Low</th>
                      <th className="num">Close</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.r.candles.slice(0, 4).map((c) => (
                      <tr key={c.time}>
                        <td>{formatDateTime(c.time, tz)}</td>
                        <td className="num">{c.open}</td>
                        <td className="num">{c.high}</td>
                        <td className="num">{c.low}</td>
                        <td className="num">{c.close}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex gap-2">
                <Button variant="primary" onClick={save} disabled={busy}>
                  {busy ? 'Saving…' : `Save ${plural(parsed.r.candles.length, 'candle')}`}
                </Button>
                <Button variant="ghost" onClick={() => setFile(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </Panel>

        <Panel title="Where to get free data">
          <div className="space-y-4 text-[14px]">
            <Source title="One click: Markets page">
              Download crypto from Binance (no key) or forex from Twelve Data (free key) straight into EdgeLab, and update it later with one button.{' '}
              <button type="button" className="text-brass-fg underline" onClick={() => go('markets')}>
                Open Markets
              </button>
            </Source>
            <Source title="MetaTrader 5">
              Open the Symbols window (Ctrl+U), go to the Bars tab, choose the symbol and the M1 timeframe, set the dates, then Request and Export Bars. MT5 times are in your broker's server time, usually UTC+2 or UTC+3, so pick that time zone when you import.
            </Source>
            <Source title="Dukascopy">
              Free bank-grade history for majors, metals and crosses. From the project folder run <code className="rounded bg-ink-950 px-1.5 py-0.5 text-[13px]">npm run data -- --pair xauusd --from 2025-01-01 --to 2025-03-31 --tf m1</code> and import the CSV it saves. Times are UTC.
            </Source>
            <Source title="HistData.com">
              Free M1 history by month in Generic ASCII format. Its timestamps are New York standard time; EdgeLab converts them to UTC for you.
            </Source>
            <p className="text-[13px] text-fg-3">Tip: import M1 and replay on M15, H1 or H4. Stops and targets are then checked minute by minute inside every bigger candle.</p>
          </div>
        </Panel>
      </div>

      <Panel title="Saved data" className="mt-4" bodyClass="p-0">
        <div className="overflow-x-auto">
          <table className="table-data">
            <thead>
              <tr>
                <th>Name</th>
                <th>Pair</th>
                <th>Timeframe</th>
                <th>From</th>
                <th>To</th>
                <th className="num">Candles</th>
                <th>Source</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {datasets.map((d) => (
                <tr key={d.id}>
                  <td className="font-medium">{d.name}</td>
                  <td>{d.symbol}</td>
                  <td>{tfLabel(d.tfSec)}</td>
                  <td>{formatDate(d.start, tz)}</td>
                  <td>{formatDate(d.end, tz)}</td>
                  <td className="num">{d.count.toLocaleString()}</td>
                  <td className="text-fg-2">{d.format}</td>
                  <td className="num">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" onClick={() => go('backtest', `d-${d.id}`)}>
                        Chart
                      </Button>
                      {!d.builtIn && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            if (await confirm({ title: `Delete ${d.name}?`, body: 'Replay sessions that use this data can no longer be opened.', confirmLabel: 'Delete data', danger: true })) {
                              await deleteDataset(d.id);
                              toast('Data deleted');
                            }
                          }}
                        >
                          Delete
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-fg-3">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}

function Source({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-0.5 text-fg-2">{children}</p>
    </div>
  );
}
