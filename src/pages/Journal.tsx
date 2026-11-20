import { useEffect, useMemo, useRef, useState } from 'react';
import type { TradeRecord } from '../core/types';
import { formatDateTime, sessionOf } from '../core/time';
import { useApp } from '../state/AppContext';
import { TradeForm } from '../components/TradeForm';
import { Button, EmptyState, PageHeader, Segmented, SideBadge, Stars } from '../components/ui';
import { csvToTrades, TEMPLATE_CSV, tradesToCsv } from '../lib/journal-csv';
import { saveFile } from '../lib/host';
import { lots as fmtLots, money, plural, pnlClass, price as fmtPrice, rMult, signed } from '../lib/format';

type Source = 'all' | 'live' | 'backtest';
type Result = 'all' | 'win' | 'loss';

export function Journal() {
  const { trades, settings, instrumentFor, pricing, saveTrades, toast, param, go, instruments } = useApp();
  const tz = settings.timezone;
  const ccy = settings.accountCurrency;
  const [q, setQ] = useState('');
  const [source, setSource] = useState<Source>('all');
  const [pair, setPair] = useState('');
  const [setup, setSetup] = useState('');
  const [result, setResult] = useState<Result>('all');
  const [limit, setLimit] = useState(100);
  const [editing, setEditing] = useState<TradeRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (param === 'new') {
      setCreating(true);
      go('journal');
    }
  }, [param, go]);

  const pairs = useMemo(() => [...new Set(trades.map((t) => t.symbol))].sort(), [trades]);
  const setups = useMemo(() => [...new Set(trades.map((t) => t.setup).filter(Boolean))].sort(), [trades]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return trades
      .filter(
        (t) =>
          (source === 'all' || t.source === source) &&
          (!pair || t.symbol === pair) &&
          (!setup || t.setup === setup) &&
          (result === 'all' || (result === 'win' ? t.pnl > 0 : t.pnl < 0)) &&
          (!needle || [t.notes, t.setup, t.symbol, t.emotion, ...t.tags, ...t.mistakes].join(' ').toLowerCase().includes(needle)),
      )
      .sort((a, b) => b.entryTime - a.entryTime);
  }, [trades, q, source, pair, setup, result]);

  const totals = useMemo(() => filtered.reduce((a, t) => ({ pnl: a.pnl + t.pnl, r: a.r + (t.rMultiple ?? 0) }), { pnl: 0, r: 0 }), [filtered]);

  const download = async (name: string, text: string) => {
    const r = await saveFile(name, text);
    if (r === 'failed') toast('This page cannot save files here.', 'error');
  };

  const onImport = async (file: File) => {
    try {
      const text = await file.text();
      const res = csvToTrades(text, pricing, tz, instruments);
      await saveTrades(res.trades);
      toast(`Imported ${plural(res.trades.length, 'trade')}${res.skipped ? `, skipped ${res.skipped} row(s) that were missing prices or times` : ''}.`, 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <div>
      <PageHeader
        title="Journal"
        intro="Every trade you take, live or in a backtest, with the context that explains it."
        actions={
          <>
            <Button variant="primary" onClick={() => setCreating(true)}>
              Log a trade
            </Button>
            <Button onClick={() => fileRef.current?.click()}>Import CSV</Button>
            <Button variant="ghost" onClick={() => void download(`edgelab-journal-${new Date().toISOString().slice(0, 10)}.csv`, tradesToCsv(filtered))} disabled={!filtered.length}>
              Export CSV
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onImport(f);
                e.target.value = '';
              }}
            />
          </>
        }
      />

      {trades.length === 0 ? (
        <EmptyState
          title="Your journal is empty"
          actions={
            <>
              <Button variant="primary" onClick={() => setCreating(true)}>
                Log your first trade
              </Button>
              <Button variant="ghost" onClick={() => void download('edgelab-journal-template.csv', TEMPLATE_CSV)}>
                Download CSV template
              </Button>
            </>
          }
        >
          Log trades by hand, import them from a CSV, or take trades in a backtest: they all land here. Add the setup, how you felt and what went wrong, and the dashboard turns it into patterns.
        </EmptyState>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input className="field w-[220px]" type="search" placeholder="Search notes, tags, setups" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
            <Segmented
              label="Source"
              value={source}
              onChange={setSource}
              options={[
                { value: 'all', label: 'All' },
                { value: 'live', label: 'Live' },
                { value: 'backtest', label: 'Backtest' },
              ]}
            />
            <select className="field w-auto" value={pair} onChange={(e) => setPair(e.target.value)} aria-label="Pair">
              <option value="">All pairs</option>
              {pairs.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
            <select className="field w-auto" value={setup} onChange={(e) => setSetup(e.target.value)} aria-label="Setup">
              <option value="">All setups</option>
              {setups.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <select className="field w-auto" value={result} onChange={(e) => setResult(e.target.value as Result)} aria-label="Result">
              <option value="all">Wins and losses</option>
              <option value="win">Wins only</option>
              <option value="loss">Losses only</option>
            </select>
            <div className="ml-auto text-[13px] text-fg-2 type-data">
              {plural(filtered.length, 'trade')}, <span className={`font-semibold ${pnlClass(totals.pnl)}`}>{money(totals.pnl, ccy, { signed: true })}</span>, {rMult(totals.r, 1)}
            </div>
          </div>

          <div className="panel overflow-x-auto">
            <table className="table-data">
              <thead>
                <tr>
                  <th>Opened</th>
                  <th>Pair</th>
                  <th>Side</th>
                  <th>Setup</th>
                  <th>Session</th>
                  <th className="num">Entry</th>
                  <th className="num">Exit</th>
                  <th className="num">Lots</th>
                  <th className="num">Pips</th>
                  <th className="num">R</th>
                  <th className="num">P&L</th>
                  <th>Review</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, limit).map((t) => {
                  const digits = instrumentFor(t.symbol).digits;
                  return (
                    <tr key={t.id} className="cursor-pointer" onClick={() => setEditing(t)}>
                      <td>
                        <button type="button" className="text-left hover:text-brass-fg" onClick={(e) => { e.stopPropagation(); setEditing(t); }}>
                          {formatDateTime(t.entryTime, tz)}
                        </button>
                      </td>
                      <td className="font-medium">{t.symbol}</td>
                      <td>
                        <SideBadge side={t.side} />
                      </td>
                      <td className="max-w-[180px] truncate text-fg-2">{t.setup || '—'}</td>
                      <td className="text-fg-2">{sessionOf(t.entryTime)}</td>
                      <td className="num">{fmtPrice(t.entryPrice, digits)}</td>
                      <td className="num">{fmtPrice(t.exitPrice, digits)}</td>
                      <td className="num">{fmtLots(t.lots)}</td>
                      <td className="num">{signed(t.pips, 1)}</td>
                      <td className={`num ${pnlClass(t.rMultiple)}`}>{rMult(t.rMultiple)}</td>
                      <td className={`num font-semibold ${pnlClass(t.pnl)}`}>{money(t.pnl, ccy, { signed: true })}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          {t.rating ? <Stars value={t.rating} size={12} /> : null}
                          {t.mistakes.length > 0 && <span className="rounded bg-loss/15 px-1.5 text-[12px] text-loss-fg">{plural(t.mistakes.length, 'mistake')}</span>}
                          {!t.rating && !t.mistakes.length && !t.notes && <span className="text-[12px] text-fg-3">Not reviewed</span>}
                        </div>
                      </td>
                      <td className="text-fg-2">{t.source === 'backtest' ? 'Backtest' : 'Live'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length === 0 && <p className="px-4 py-6 text-fg-3">No trades match these filters.</p>}
          </div>
          {filtered.length > limit && (
            <div className="mt-3 flex justify-center">
              <Button onClick={() => setLimit((l) => l + 100)}>Show {Math.min(100, filtered.length - limit)} more</Button>
            </div>
          )}
          <p className="mt-3 text-[12px] text-fg-3">
            Importing from a broker? Export your history as CSV with columns like symbol, side, entry_time, exit_time, entry_price, exit_price and lots.{' '}
            <button type="button" className="text-brass-fg underline" onClick={() => void download('edgelab-journal-template.csv', TEMPLATE_CSV)}>
              Download the template
            </button>
            .
          </p>
        </>
      )}
      <TradeForm open={creating || !!editing} trade={editing} onClose={() => { setEditing(null); setCreating(false); }} />
    </div>
  );
}
