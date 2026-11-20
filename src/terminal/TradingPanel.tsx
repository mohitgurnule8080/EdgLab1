import { useEffect, useState, type ReactNode } from 'react';
import type { Instrument, Side, TradeRecord } from '../core/types';
import type { ClosedTrade, ReplayEngine, ReplayEvent } from '../core/replay';
import { roundLots } from '../core/sizing';
import { formatDate, formatDateTime, tfLabel } from '../core/time';
import type { SessionRecord } from '../store/db';
import { Button, SideBadge, Stars } from '../components/ui';
import { lots as fmtLots, money, pct, plural, pnlClass, price as fmtPrice, rMult, signed } from '../lib/format';
import { displaySymbol } from '../core/instruments';
import { IChevronDown, IChevronUp } from './toolIcons';

export type BottomTab = 'positions' | 'orders' | 'history' | 'journal' | 'sessions';

export function closedToRecord(t: ClosedTrade, s: SessionRecord): TradeRecord {
  return {
    id: `${s.id}-${t.id}`,
    source: 'backtest',
    sessionId: s.id,
    symbol: s.symbol,
    side: t.side,
    entryTime: t.entryTime,
    exitTime: t.exitTime,
    entryPrice: t.entryPrice,
    exitPrice: t.exitPrice,
    lots: t.lots,
    sl: t.initialSl,
    tp: t.tp,
    pnl: Number(t.pnl.toFixed(2)),
    fees: Number(t.commission.toFixed(2)),
    rMultiple: t.rMultiple,
    pips: t.pips,
    setup: s.setup,
    tags: [],
    mistakes: [],
    emotion: '',
    rating: 0,
    notes: t.note ?? '',
    screenshot: '',
    exitReason: t.exitReason,
    createdAt: t.exitTime,
    updatedAt: Math.floor(Date.now() / 1000),
  };
}

const Empty = ({ children }: { children: ReactNode }) => <p className="px-4 py-5 text-[13px] text-fg-3">{children}</p>;

/** Bottom panel: account numbers and tabs, like a trading panel under the chart. */
export function TradingPanel(p: {
  open: boolean;
  setOpen(v: boolean): void;
  tab: BottomTab;
  setTab(t: BottomTab): void;
  tabs: { id: BottomTab; label: string; badge?: number }[];
  summary?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={`flex min-h-0 flex-col overflow-hidden rounded-[var(--radius-panel)] border border-ink-700 bg-ink-900 ${p.open ? 'lg:h-[260px]' : ''}`} aria-label="Trading panel">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-ink-700 px-2 py-1">
        <div className="flex items-center gap-0.5 overflow-x-auto" role="tablist">
          {p.tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={p.tab === t.id}
              onClick={() => {
                p.setTab(t.id);
                p.setOpen(true);
              }}
              className={`relative h-8 shrink-0 rounded-[var(--radius-ctl)] px-2.5 text-[13px] transition ${p.tab === t.id && p.open ? 'font-semibold text-fg' : 'text-fg-2 hover:bg-ink-850 hover:text-fg'}`}
            >
              {t.label}
              {t.badge ? <span className="type-data ml-1.5 rounded bg-ink-800 px-1.5 text-[11px] text-fg">{t.badge}</span> : null}
              {p.tab === t.id && p.open && <span className="absolute inset-x-2.5 -bottom-[5px] h-[2px] rounded-full bg-brass" aria-hidden />}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1">
          {p.summary}
          {p.actions}
          <button type="button" onClick={() => p.setOpen(!p.open)} className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-ctl)] text-fg-2 hover:bg-ink-850 hover:text-fg" aria-label={p.open ? 'Collapse panel' : 'Expand panel'} aria-expanded={p.open}>
            {p.open ? <IChevronDown size={16} /> : <IChevronUp size={16} />}
          </button>
        </div>
      </div>
      {p.open && <div className="min-h-0 flex-1 overflow-auto max-lg:max-h-[420px]">{p.children}</div>}
    </section>
  );
}

export function Metric({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <div className="leading-tight">
      <div className="text-[11px] text-fg-3">{label}</div>
      <div className={`type-data text-[13px] font-semibold ${className}`}>{value}</div>
    </div>
  );
}

/* ---------------- Positions ---------------- */

export function PositionsTable({ engine, inst, currency, onEvents, onError }: { engine: ReplayEngine; inst: Instrument; currency: string; onEvents(e?: ReplayEvent[]): void; onError(msg: string): void }) {
  if (!engine.positions.length) return <Empty>No open positions. Use the order panel on the right, or the Buy and Sell buttons on the chart.</Empty>;
  return (
    <table className="table-data">
      <thead>
        <tr>
          <th>Side</th>
          <th className="num">{inst.minLot >= 1 ? 'Contracts' : 'Lots'}</th>
          <th className="num">Entry</th>
          <th className="num">Stop loss</th>
          <th className="num">Take profit</th>
          <th className="num">Pips</th>
          <th className="num">R</th>
          <th className="num">P&L</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {engine.positions.map((pos) => {
          const exitNow = engine.exitPriceNow(pos);
          const dir = pos.side === 'buy' ? 1 : -1;
          const risk = pos.initialSl !== undefined ? Math.abs(pos.entryPrice - pos.initialSl) : 0;
          return (
            <PositionRow
              key={pos.id}
              side={pos.side}
              lots={pos.lots}
              entry={pos.entryPrice}
              sl={pos.sl}
              tp={pos.tp}
              pips={((exitNow - pos.entryPrice) * dir) / inst.pipSize}
              r={risk ? ((exitNow - pos.entryPrice) * dir) / risk : null}
              pnl={engine.unrealized(pos)}
              digits={inst.digits}
              currency={currency}
              onModify={(sl, tp) => {
                const res = engine.modifyPosition(pos.id, { sl, tp });
                if (!res.ok) onError(res.error);
                else onEvents();
              }}
              onBreakeven={() => {
                const res = engine.modifyPosition(pos.id, { sl: pos.entryPrice });
                if (!res.ok) onError('Price has to be past your entry to move the stop to breakeven.');
                else onEvents();
              }}
              onClose={(fraction) => onEvents(engine.closePosition(pos.id, fraction < 1 ? roundLots(inst, pos.lots * fraction) || pos.lots : pos.lots))}
            />
          );
        })}
      </tbody>
    </table>
  );
}

function PositionRow(props: {
  side: Side;
  lots: number;
  entry: number;
  sl?: number;
  tp?: number;
  pips: number;
  r: number | null;
  pnl: number;
  digits: number;
  currency: string;
  onModify(sl: number | null, tp: number | null): void;
  onBreakeven(): void;
  onClose(fraction: number): void;
}) {
  const [edit, setEdit] = useState(false);
  const [sl, setSl] = useState('');
  const [tp, setTp] = useState('');
  const startEdit = () => {
    setSl(props.sl !== undefined ? String(props.sl) : '');
    setTp(props.tp !== undefined ? String(props.tp) : '');
    setEdit(true);
  };
  const save = () => {
    props.onModify(sl.trim() ? Number(sl) : null, tp.trim() ? Number(tp) : null);
    setEdit(false);
  };
  return (
    <tr>
      <td>
        <SideBadge side={props.side} />
      </td>
      <td className="num">{fmtLots(props.lots)}</td>
      <td className="num">{fmtPrice(props.entry, props.digits)}</td>
      <td className="num">{edit ? <input className="field h-7 min-h-0 w-[100px] py-0 type-data" type="number" step="any" value={sl} onChange={(e) => setSl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} aria-label="Stop loss" /> : fmtPrice(props.sl, props.digits)}</td>
      <td className="num">{edit ? <input className="field h-7 min-h-0 w-[100px] py-0 type-data" type="number" step="any" value={tp} onChange={(e) => setTp(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} aria-label="Take profit" /> : fmtPrice(props.tp, props.digits)}</td>
      <td className="num">{signed(props.pips, 1)}</td>
      <td className={`num ${pnlClass(props.r)}`}>{rMult(props.r)}</td>
      <td className={`num font-semibold ${pnlClass(props.pnl)}`}>{money(props.pnl, props.currency, { signed: true })}</td>
      <td className="num">
        <div className="flex justify-end gap-1">
          {edit ? (
            <>
              <Button size="sm" variant="primary" onClick={save}>
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEdit(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="ghost" onClick={startEdit}>
                Edit
              </Button>
              <Button size="sm" variant="ghost" onClick={props.onBreakeven} title="Move stop loss to the entry price">
                Breakeven
              </Button>
              <Button size="sm" variant="ghost" onClick={() => props.onClose(0.5)}>
                Close half
              </Button>
              <Button size="sm" onClick={() => props.onClose(1)}>
                Close
              </Button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

/* ---------------- Orders ---------------- */

export function OrdersTable({ engine, inst, tz, onCancel }: { engine: ReplayEngine; inst: Instrument; tz: string; onCancel(id: string): void }) {
  if (!engine.pending.length) return <Empty>No pending orders. Choose Limit or Stop in the order panel to place one.</Empty>;
  return (
    <table className="table-data">
      <thead>
        <tr>
          <th>Order</th>
          <th className="num">Size</th>
          <th className="num">Price</th>
          <th className="num">Stop loss</th>
          <th className="num">Take profit</th>
          <th>Placed</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {engine.pending.map((o) => (
          <tr key={o.id}>
            <td>
              <SideBadge side={o.side} /> <span className="ml-1 text-fg-2">{o.kind}</span>
            </td>
            <td className="num">{fmtLots(o.lots)}</td>
            <td className="num">{fmtPrice(o.price, inst.digits)}</td>
            <td className="num">{fmtPrice(o.sl, inst.digits)}</td>
            <td className="num">{fmtPrice(o.tp, inst.digits)}</td>
            <td className="text-fg-2">{formatDateTime(o.placedAt, tz, false)}</td>
            <td className="num">
              <Button size="sm" variant="ghost" onClick={() => onCancel(o.id)}>
                Cancel
              </Button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ---------------- History ---------------- */

export function HistoryTable({ engine, session, inst, currency, tz, journal, onReview }: { engine: ReplayEngine; session: SessionRecord; inst: Instrument; currency: string; tz: string; journal: Map<string, TradeRecord>; onReview(r: TradeRecord): void }) {
  if (!engine.closed.length) return <Empty>Closed trades appear here and in your journal.</Empty>;
  return (
    <table className="table-data">
      <thead>
        <tr>
          <th>Side</th>
          <th>Opened</th>
          <th className="num">Entry</th>
          <th className="num">Exit</th>
          <th>Exit by</th>
          <th className="num">Pips</th>
          <th className="num">R</th>
          <th className="num">P&L</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {[...engine.closed].reverse().map((t) => {
          const rec = journal.get(`${session.id}-${t.id}`);
          const reviewed = rec && (rec.notes || rec.mistakes.length || rec.rating);
          return (
            <tr key={t.id}>
              <td>
                <SideBadge side={t.side} />
              </td>
              <td className="text-fg-2">{formatDateTime(t.entryTime, tz, false)}</td>
              <td className="num">{fmtPrice(t.entryPrice, inst.digits)}</td>
              <td className="num">{fmtPrice(t.exitPrice, inst.digits)}</td>
              <td className="text-fg-2">
                {t.exitReason === 'tp' ? 'Take profit' : t.exitReason === 'sl' ? 'Stop loss' : t.exitReason === 'end' ? 'Session end' : 'Manual'}
                {t.partials > 1 ? `, ${t.partials} parts` : ''}
              </td>
              <td className="num">{signed(t.pips, 1)}</td>
              <td className={`num font-semibold ${pnlClass(t.rMultiple)}`}>{rMult(t.rMultiple, 2)}</td>
              <td className={`num font-semibold ${pnlClass(t.pnl)}`}>{money(t.pnl, currency, { signed: true })}</td>
              <td className="num">
                <Button size="sm" variant={reviewed ? 'ghost' : 'outline'} onClick={() => onReview(rec ?? closedToRecord(t, session))}>
                  {reviewed ? 'Edit journal' : 'Journal it'}
                </Button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ---------------- Journal ---------------- */

function NotesBox({ value, onSave, label, placeholder }: { value: string; onSave(v: string): void; label: string; placeholder: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] text-fg-3">{label}</span>
      <textarea className="field min-h-[96px] resize-y text-[13px]" value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onBlur={() => text !== value && onSave(text)} />
    </label>
  );
}

/** Journal entries for a list of trades, with the notes box for the session or the market. */
export function JournalTab({
  trades,
  currency,
  tz,
  notes,
  onNotes,
  notesLabel,
  onReview,
  onNew,
  emptyText,
}: {
  trades: TradeRecord[];
  currency: string;
  tz: string;
  notes?: string;
  onNotes?(v: string): void;
  notesLabel?: string;
  onReview(r: TradeRecord): void;
  onNew?(): void;
  emptyText: string;
}) {
  const list = [...trades].sort((a, b) => b.exitTime - a.exitTime);
  const toReview = list.filter((t) => !t.notes && !t.mistakes.length && !t.rating).length;
  return (
    <div className={`grid gap-4 p-3 ${onNotes ? 'lg:grid-cols-[minmax(0,1fr)_300px]' : ''}`}>
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px] text-fg-3">
          <span>
            {plural(list.length, 'trade')}
            {toReview ? `, ${toReview} not journaled yet` : list.length ? ', all journaled' : ''}
          </span>
          {onNew && (
            <Button size="sm" variant="outline" className="ml-auto" onClick={onNew}>
              Log a live trade
            </Button>
          )}
        </div>
        {list.length === 0 ? (
          <p className="text-[13px] text-fg-3">{emptyText}</p>
        ) : (
          <table className="table-data">
            <thead>
              <tr>
                <th>Closed</th>
                <th>Trade</th>
                <th>Setup</th>
                <th>Feeling</th>
                <th>Execution</th>
                <th>Notes</th>
                <th className="num">R</th>
                <th className="num">P&L</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.slice(0, 200).map((t) => (
                <tr key={t.id}>
                  <td className="text-fg-2">{formatDate(t.exitTime, tz)}</td>
                  <td>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="font-medium">{displaySymbol(t.symbol)}</span>
                      <SideBadge side={t.side} />
                      {t.source === 'backtest' && <span className="text-[11px] text-fg-3">replay</span>}
                    </span>
                  </td>
                  <td className="max-w-[140px] truncate text-fg-2">{t.setup || '—'}</td>
                  <td className="text-fg-2">{t.emotion || '—'}</td>
                  <td>{t.rating ? <Stars value={t.rating} size={13} /> : <span className="text-fg-3">—</span>}</td>
                  <td className="max-w-[220px] truncate text-fg-2" title={t.notes}>
                    {t.notes || (t.mistakes.length ? t.mistakes.join(', ') : '—')}
                  </td>
                  <td className={`num ${pnlClass(t.rMultiple)}`}>{rMult(t.rMultiple, 2)}</td>
                  <td className={`num font-semibold ${pnlClass(t.pnl)}`}>{money(t.pnl, currency, { signed: true })}</td>
                  <td className="num">
                    <Button size="sm" variant={t.notes || t.rating ? 'ghost' : 'outline'} onClick={() => onReview(t)}>
                      {t.notes || t.rating ? 'Edit' : 'Journal it'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {onNotes && <NotesBox value={notes ?? ''} onSave={onNotes} label={notesLabel ?? 'Notes'} placeholder="Plan before you start: bias, levels, what you are looking for. Review after: what you did well and what to fix." />}
    </div>
  );
}

/* ---------------- Sessions ---------------- */

export function SessionsList({ sessions, current, tz, currency, onOpen, onDelete }: { sessions: SessionRecord[]; current?: string; tz: string; currency: string; onOpen(s: SessionRecord): void; onDelete(s: SessionRecord): void }) {
  if (!sessions.length) return <Empty>No replay sessions yet. Press Replay in the top bar and click the candle to start from.</Empty>;
  return (
    <table className="table-data">
      <thead>
        <tr>
          <th>Session</th>
          <th>Reached</th>
          <th className="num">Trades</th>
          <th className="num">Win rate</th>
          <th className="num">Net R</th>
          <th className="num">Net P&L</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {[...sessions]
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .map((s) => {
            const closed = s.state.closed;
            const wins = closed.filter((t) => t.pnl > 0).length;
            const netR = closed.reduce((a, t) => a + (t.rMultiple ?? 0), 0);
            const net = closed.reduce((a, t) => a + t.pnl, 0);
            return (
              <tr key={s.id} className={s.id === current ? 'bg-ink-850' : ''}>
                <td>
                  <div className="font-medium">{s.name}</div>
                  <div className="text-[12px] text-fg-3">
                    {displaySymbol(s.symbol)} {tfLabel(s.displayTfSec)}
                    {s.setup ? `, ${s.setup}` : ''}
                    {s.status === 'finished' ? ', finished' : ''}
                  </div>
                </td>
                <td className="text-fg-2">{s.cursorTime ? formatDateTime(s.cursorTime, tz) : '—'}</td>
                <td className="num">{closed.length}</td>
                <td className="num">{closed.length ? pct(wins / closed.length, 0) : '—'}</td>
                <td className={`num ${pnlClass(netR)}`}>{rMult(netR, 1)}</td>
                <td className={`num font-semibold ${pnlClass(net)}`}>{money(net, currency, { signed: true })}</td>
                <td className="num">
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant={s.id === current ? 'ghost' : 'outline'} onClick={() => onOpen(s)} disabled={s.id === current}>
                      {s.id === current ? 'Open now' : 'Resume'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => onDelete(s)}>
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
      </tbody>
    </table>
  );
}
