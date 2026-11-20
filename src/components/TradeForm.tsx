import { useEffect, useMemo, useState } from 'react';
import type { Side, TradeRecord } from '../core/types';
import { fromLocalInput, sessionOf, toLocalInput } from '../core/time';
import { grossPnl, pipsBetween } from '../core/sizing';
import { normaliseSymbol } from '../core/instruments';
import { useApp } from '../state/AppContext';
import { money, pnlClass, rMult, signed, uid } from '../lib/format';
import { Button, Chip, Field, Segmented, Sheet, Stars } from './ui';

export const MISTAKES = ['FOMO entry', 'Moved SL', 'Early exit', 'Oversized', 'Revenge trade', 'No setup', 'Chased price', 'Ignored plan'];
export const EMOTIONS = ['Calm', 'Focused', 'Confident', 'Impatient', 'Anxious', 'Fearful', 'Greedy', 'Frustrated', 'Bored'];

interface Draft {
  symbol: string;
  side: Side;
  entryTime: string;
  exitTime: string;
  entryPrice: string;
  exitPrice: string;
  sl: string;
  tp: string;
  lots: string;
  fees: string;
  brokerPnl: string;
  useBrokerPnl: boolean;
  setup: string;
  tags: string;
  mistakes: string[];
  emotion: string;
  rating: number;
  screenshot: string;
  notes: string;
}

const str = (v: number | undefined | null) => (v === undefined || v === null || !Number.isFinite(v) ? '' : String(v));
const num = (s: string) => (s.trim() === '' ? undefined : Number(s));

function toDraft(t: TradeRecord | null, tz: string, symbol = 'EURUSD'): Draft {
  const now = Math.floor(Date.now() / 1000);
  return {
    symbol: t?.symbol ?? symbol,
    side: t?.side ?? 'buy',
    entryTime: toLocalInput(t?.entryTime ?? now - 3600, tz),
    exitTime: toLocalInput(t?.exitTime ?? now, tz),
    entryPrice: str(t?.entryPrice),
    exitPrice: str(t?.exitPrice),
    sl: str(t?.sl),
    tp: str(t?.tp),
    lots: str(t?.lots ?? 0.1),
    fees: str(t?.fees ?? 0),
    brokerPnl: t ? String(Number(t.pnl.toFixed(2))) : '',
    useBrokerPnl: false,
    setup: t?.setup ?? '',
    tags: t?.tags.join(', ') ?? '',
    mistakes: t?.mistakes ?? [],
    emotion: t?.emotion ?? '',
    rating: t?.rating ?? 0,
    screenshot: t?.screenshot ?? '',
    notes: t?.notes ?? '',
  };
}

export function TradeForm({ open, trade, onClose, symbol }: { open: boolean; trade: TradeRecord | null; onClose(): void; /** Pair for a new trade. */ symbol?: string }) {
  const { settings, instruments, instrumentFor, pricing, trades, saveTrades, deleteTrades, toast, confirm } = useApp();
  const tz = settings.timezone;
  const [d, setD] = useState<Draft>(() => toDraft(trade, tz, symbol));
  const [customMistake, setCustomMistake] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setD(toDraft(trade, tz, symbol));
      setError(null);
    }
  }, [open, trade, tz, symbol]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const inst = instrumentFor(d.symbol || 'EURUSD');
  const setups = useMemo(() => [...new Set(trades.map((t) => t.setup).filter(Boolean))].sort(), [trades]);
  const knownMistakes = useMemo(() => [...new Set([...MISTAKES, ...trades.flatMap((t) => t.mistakes)])], [trades]);

  const calc = useMemo(() => {
    const entry = num(d.entryPrice);
    const exit = num(d.exitPrice);
    const lots = num(d.lots);
    const sl = num(d.sl);
    const fees = num(d.fees) ?? 0;
    if (!entry || !exit || !lots) return null;
    const gross = grossPnl(inst, d.side, entry, exit, lots, pricing);
    const dir = d.side === 'buy' ? 1 : -1;
    const risk = sl ? Math.abs(entry - sl) : 0;
    return {
      pnl: d.useBrokerPnl && num(d.brokerPnl) !== undefined ? (num(d.brokerPnl) as number) : gross - fees,
      pips: pipsBetween(inst, d.side, entry, exit),
      r: risk > 0 ? ((exit - entry) * dir) / risk : null,
    };
  }, [d, inst, pricing]);

  const entryUtc = fromLocalInput(d.entryTime, tz);

  const save = async () => {
    const entry = num(d.entryPrice);
    const exit = num(d.exitPrice);
    const lots = num(d.lots);
    const exitUtc = fromLocalInput(d.exitTime, tz);
    if (!d.symbol.trim()) return setError('Choose the pair you traded.');
    if (!entry || !exit) return setError('Enter both the entry and exit price.');
    if (!lots || lots <= 0) return setError('Enter the position size in lots.');
    if (entryUtc === null || exitUtc === null) return setError('Enter the entry and exit time.');
    if (exitUtc < entryUtc) return setError('The exit time is before the entry time.');
    const sl = num(d.sl);
    if (sl !== undefined && (d.side === 'buy' ? sl >= entry : sl <= entry)) {
      return setError(d.side === 'buy' ? 'For a long trade the stop loss must be below the entry.' : 'For a short trade the stop loss must be above the entry.');
    }
    if (!calc) return;
    const now = Math.floor(Date.now() / 1000);
    const record: TradeRecord = {
      id: trade?.id ?? uid('t'),
      source: trade?.source ?? 'live',
      sessionId: trade?.sessionId,
      symbol: normaliseSymbol(d.symbol),
      side: d.side,
      entryTime: entryUtc,
      exitTime: exitUtc,
      entryPrice: entry,
      exitPrice: exit,
      lots,
      sl,
      tp: num(d.tp),
      pnl: Number(calc.pnl.toFixed(2)),
      fees: num(d.fees) ?? 0,
      rMultiple: calc.r,
      pips: calc.pips,
      setup: d.setup.trim(),
      tags: d.tags.split(',').map((x) => x.trim()).filter(Boolean),
      mistakes: d.mistakes,
      emotion: d.emotion,
      rating: d.rating,
      notes: d.notes,
      screenshot: d.screenshot.trim(),
      exitReason: trade?.exitReason,
      sample: trade?.sample,
      createdAt: trade?.createdAt ?? now,
      updatedAt: now,
    };
    await saveTrades([record]);
    toast(trade ? 'Trade updated' : 'Trade logged', 'success');
    onClose();
  };

  const remove = async () => {
    if (!trade) return;
    if (!(await confirm({ title: 'Delete this trade?', body: 'It is removed from your journal and statistics.', confirmLabel: 'Delete trade', danger: true }))) return;
    await deleteTrades([trade.id]);
    toast('Trade deleted');
    onClose();
  };

  const isImage = /\.(png|jpe?g|webp|gif)(\?.*)?$/i.test(d.screenshot) || d.screenshot.startsWith('data:image');
  const isBacktest = trade?.source === 'backtest';

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={trade ? `${trade.symbol} ${trade.side === 'buy' ? 'long' : 'short'}` : 'Log a trade'}
      footer={
        <>
          {trade && (
            <Button variant="danger" onClick={remove} className="mr-auto">
              Delete
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save}>
            {trade ? 'Save changes' : 'Save trade'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {isBacktest && <p className="rounded-[var(--radius-ctl)] bg-ink-850 px-3 py-2 text-[13px] text-fg-2">This trade came from a backtest. Prices are from the replay; add your setup, notes and review.</p>}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Pair">
            <input className="field" list="symbols" value={d.symbol} onChange={(e) => set('symbol', e.target.value.toUpperCase())} disabled={isBacktest} />
            <datalist id="symbols">
              {instruments.map((i) => (
                <option key={i.symbol} value={i.symbol} />
              ))}
            </datalist>
          </Field>
          <Field label="Direction">
            <Segmented
              label="Direction"
              value={d.side}
              onChange={(v) => !isBacktest && set('side', v)}
              options={[
                { value: 'buy', label: 'Long', className: 'bg-profit text-profit-ink font-semibold' },
                { value: 'sell', label: 'Short', className: 'bg-loss-strong text-white font-semibold' },
              ]}
            />
          </Field>
          <Field label="Entry time">
            <input type="datetime-local" className="field" value={d.entryTime} onChange={(e) => set('entryTime', e.target.value)} />
          </Field>
          <Field label="Exit time">
            <input type="datetime-local" className="field" value={d.exitTime} onChange={(e) => set('exitTime', e.target.value)} />
          </Field>
          <Field label="Entry price">
            <input type="number" inputMode="decimal" step="any" className="field type-data" value={d.entryPrice} onChange={(e) => set('entryPrice', e.target.value)} />
          </Field>
          <Field label="Exit price">
            <input type="number" inputMode="decimal" step="any" className="field type-data" value={d.exitPrice} onChange={(e) => set('exitPrice', e.target.value)} />
          </Field>
          <Field label="Stop loss" hint="Needed to calculate R">
            <input type="number" inputMode="decimal" step="any" className="field type-data" value={d.sl} onChange={(e) => set('sl', e.target.value)} />
          </Field>
          <Field label="Take profit">
            <input type="number" inputMode="decimal" step="any" className="field type-data" value={d.tp} onChange={(e) => set('tp', e.target.value)} />
          </Field>
          <Field label="Size (lots)">
            <input type="number" inputMode="decimal" step={inst.lotStep} className="field type-data" value={d.lots} onChange={(e) => set('lots', e.target.value)} />
          </Field>
          <Field label="Commission and swap" hint={settings.accountCurrency}>
            <input type="number" inputMode="decimal" step="any" className="field type-data" value={d.fees} onChange={(e) => set('fees', e.target.value)} />
          </Field>
        </div>

        <div className="rounded-[var(--radius-ctl)] border border-ink-700 bg-ink-950 p-3">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 type-data">
            <div>
              <span className="text-fg-3">Result </span>
              <span className={`text-[18px] font-semibold ${pnlClass(calc?.pnl)}`}>{calc ? money(calc.pnl, settings.accountCurrency, { signed: true }) : '—'}</span>
            </div>
            <div>
              <span className="text-fg-3">R </span>
              <span className="font-semibold">{rMult(calc?.r)}</span>
            </div>
            <div>
              <span className="text-fg-3">Pips </span>
              <span className="font-semibold">{calc ? signed(calc.pips, 1) : '—'}</span>
            </div>
            {entryUtc !== null && (
              <div>
                <span className="text-fg-3">Session </span>
                <span>{sessionOf(entryUtc)}</span>
              </div>
            )}
          </div>
          <label className="mt-3 flex items-center gap-2 text-[13px] text-fg-2">
            <input type="checkbox" checked={d.useBrokerPnl} onChange={(e) => set('useBrokerPnl', e.target.checked)} />
            Use the exact P&L from my broker instead
          </label>
          {d.useBrokerPnl && (
            <input type="number" inputMode="decimal" step="any" className="field type-data mt-2" placeholder="Net P&L after fees" value={d.brokerPnl} onChange={(e) => set('brokerPnl', e.target.value)} />
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Setup">
            <input className="field" list="setups" placeholder="London breakout" value={d.setup} onChange={(e) => set('setup', e.target.value)} />
            <datalist id="setups">
              {setups.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Field>
          <Field label="Tags" hint="Separate with commas">
            <input className="field" placeholder="trend, news day" value={d.tags} onChange={(e) => set('tags', e.target.value)} />
          </Field>
        </div>

        <div>
          <div className="mb-2 text-[13px] text-fg-2">Mistakes</div>
          <div className="flex flex-wrap gap-2">
            {knownMistakes.map((m) => (
              <Chip key={m} active={d.mistakes.includes(m)} onClick={() => set('mistakes', d.mistakes.includes(m) ? d.mistakes.filter((x) => x !== m) : [...d.mistakes, m])}>
                {m}
              </Chip>
            ))}
            <form
              className="flex"
              onSubmit={(e) => {
                e.preventDefault();
                const m = customMistake.trim();
                if (m && !d.mistakes.includes(m)) set('mistakes', [...d.mistakes, m]);
                setCustomMistake('');
              }}
            >
              <input className="field h-8 min-h-0 w-[150px] rounded-full py-0 text-[13px]" placeholder="Add your own" value={customMistake} onChange={(e) => setCustomMistake(e.target.value)} />
            </form>
          </div>
        </div>

        <div>
          <div className="mb-2 text-[13px] text-fg-2">How you felt</div>
          <div className="flex flex-wrap gap-2">
            {EMOTIONS.map((m) => (
              <Chip key={m} active={d.emotion === m} onClick={() => set('emotion', d.emotion === m ? '' : m)}>
                {m}
              </Chip>
            ))}
          </div>
        </div>

        <Field label="Execution rating">
          <Stars value={d.rating} onChange={(v) => set('rating', v)} size={22} />
        </Field>

        <Field label="Chart screenshot" hint="Paste a TradingView snapshot link or an image URL">
          <input className="field" placeholder="https://www.tradingview.com/x/..." value={d.screenshot} onChange={(e) => set('screenshot', e.target.value)} />
        </Field>
        {d.screenshot && (
          isImage ? (
            <img src={d.screenshot} alt="Trade chart" className="max-h-[260px] w-full rounded-[var(--radius-ctl)] border border-ink-700 object-contain" />
          ) : /^https?:\/\//.test(d.screenshot) ? (
            <a href={d.screenshot} target="_blank" rel="noreferrer" className="text-[13px] text-brass-fg underline">
              Open screenshot
            </a>
          ) : null
        )}

        <Field label="Notes">
          <textarea className="field min-h-[110px]" placeholder="Why you took it, what you saw, what you would do differently" value={d.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>

        {error && <p className="rounded-[var(--radius-ctl)] border border-loss/50 bg-loss/10 px-3 py-2 text-loss-fg">{error}</p>}
      </div>
    </Sheet>
  );
}
