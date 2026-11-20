import { useMemo, useState } from 'react';
import type { Instrument, PricingContext, Side } from '../core/types';
import type { ReplayEngine } from '../core/replay';
import { lotsForRisk, pipValuePerLot, roundLots } from '../core/sizing';
import { Button, Field, Segmented } from '../components/ui';
import { lots as fmtLots, money, price as fmtPrice } from '../lib/format';

export type ClickTarget = null | 'entry' | 'sl' | 'tp';
export type OrderKind = 'market' | 'limit' | 'stop';

/** Order ticket state and the numbers derived from it (size from risk, R:R, money at risk). */
export function useTicket(engine: ReplayEngine | null, inst: Instrument, pricing: PricingContext, cfg: { riskPct: number; commissionPerLot: number }) {
  const [side, setSide] = useState<Side>('buy');
  const [kind, setKind] = useState<OrderKind>('market');
  const [entryIn, setEntryIn] = useState('');
  const [slMode, setSlMode] = useState<'pips' | 'price'>('pips');
  const [slIn, setSlIn] = useState('20');
  const [tpMode, setTpMode] = useState<'r' | 'price'>('r');
  const [tpIn, setTpIn] = useState('2');
  const [riskIn, setRiskIn] = useState(String(cfg.riskPct));
  const [lotsIn, setLotsIn] = useState('');
  const [clickTarget, setClickTarget] = useState<ClickTarget>(null);

  const bid = engine?.bid ?? NaN;
  const ask = engine?.ask ?? NaN;
  const entryRef = kind === 'market' ? (side === 'buy' ? ask : bid) : Number(entryIn) || NaN;
  const dir = side === 'buy' ? 1 : -1;
  const slPrice = useMemo(() => {
    const v = Number(slIn);
    if (!slIn.trim() || !Number.isFinite(v) || v <= 0) return undefined;
    return slMode === 'pips' ? entryRef - dir * v * inst.pipSize : v;
  }, [slIn, slMode, entryRef, dir, inst.pipSize]);
  const tpPrice = useMemo(() => {
    const v = Number(tpIn);
    if (!tpIn.trim() || !Number.isFinite(v) || v <= 0) return undefined;
    if (tpMode === 'price') return v;
    if (slPrice === undefined || !Number.isFinite(entryRef)) return undefined;
    return entryRef + dir * v * Math.abs(entryRef - slPrice);
  }, [tpIn, tpMode, slPrice, entryRef, dir]);
  const sizing =
    engine && slPrice !== undefined && Number.isFinite(entryRef)
      ? lotsForRisk({ inst, ctx: pricing, balance: engine.balance, riskPct: Number(riskIn) || 0, entry: entryRef, sl: slPrice, commissionPerLot: cfg.commissionPerLot })
      : null;
  const manualLots = lotsIn.trim() ? roundLots(inst, Number(lotsIn)) : null;
  const orderLots = manualLots ?? sizing?.lots ?? 0;
  const rr = slPrice !== undefined && tpPrice !== undefined && Number.isFinite(entryRef) ? Math.abs(tpPrice - entryRef) / Math.abs(entryRef - slPrice) : null;
  const riskMoney =
    slPrice !== undefined && Number.isFinite(entryRef) && orderLots > 0
      ? (Math.abs(entryRef - slPrice) / inst.pipSize) * pipValuePerLot(inst, slPrice, pricing) * orderLots + cfg.commissionPerLot * orderLots
      : null;
  const roundP = (v: number) => Number(v.toFixed(inst.digits));

  /** Fill the ticket from a long / short position drawing. */
  const fromPosition = (long: boolean, entry: number, stop: number, target: number) => {
    setSide(long ? 'buy' : 'sell');
    const market = long ? ask : bid;
    const near = Math.abs(entry - market) <= inst.pipSize * 0.5;
    if (near) setKind('market');
    else {
      setKind((long ? entry > market : entry < market) ? 'stop' : 'limit');
      setEntryIn(String(roundP(entry)));
    }
    setSlMode('price');
    setSlIn(String(roundP(stop)));
    setTpMode('price');
    setTpIn(String(roundP(target)));
  };

  const onChartPick = (p: number) => {
    if (!clickTarget) return;
    if (clickTarget === 'entry') {
      setEntryIn(String(p));
      if (kind === 'market') setKind(dir * (p - (side === 'buy' ? ask : bid)) > 0 ? 'stop' : 'limit');
    } else if (clickTarget === 'sl') {
      setSlMode('price');
      setSlIn(String(p));
    } else {
      setTpMode('price');
      setTpIn(String(p));
    }
    setClickTarget(null);
  };

  return {
    side, setSide, kind, setKind, entryIn, setEntryIn, slMode, setSlMode, slIn, setSlIn, tpMode, setTpMode, tpIn, setTpIn,
    riskIn, setRiskIn, lotsIn, setLotsIn, clickTarget, setClickTarget,
    bid, ask, entryRef, slPrice, tpPrice, sizing, orderLots, rr, riskMoney, roundP, fromPosition, onChartPick,
  };
}

export type Ticket = ReturnType<typeof useTicket>;

function UnitToggle({ value, options, onChange }: { value: string; options: [string, string][]; onChange(v: string): void }) {
  return (
    <div className="flex gap-1 text-[12px]">
      {options.map(([v, l]) => (
        <button key={v} type="button" onClick={() => onChange(v)} aria-pressed={value === v} className={`rounded px-1.5 py-0.5 ${value === v ? 'seg-on' : 'text-fg-3 hover:text-fg'}`}>
          {l}
        </button>
      ))}
    </div>
  );
}

function PriceInput({ label, value, onChange, onPick, picking }: { label?: string; value: string; onChange(v: string): void; onPick(): void; picking: boolean }) {
  const input = (
    <div className="flex gap-1.5">
      <input type="number" step="any" inputMode="decimal" className="field type-data" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} />
      <Button size="md" variant={picking ? 'primary' : 'outline'} onClick={onPick} title="Pick the price on the chart" aria-label="Pick on chart" className="shrink-0 px-2.5">
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
          <path d="M8 1v4M8 11v4M1 8h4M11 8h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="8" cy="8" r="2" fill="currentColor" />
        </svg>
      </Button>
    </div>
  );
  return label ? <Field label={label}>{input}</Field> : input;
}

/** The order panel: sell / buy prices, order type, stop and target, size from risk. */
export function OrderTicket({ t, inst, currency, onPlace, disabled }: { t: Ticket; inst: Instrument; currency: string; onPlace(): void; disabled: boolean }) {
  return (
    <div className="space-y-3 p-3">
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => t.setSide('sell')} aria-pressed={t.side === 'sell'} className={`rounded-[var(--radius-ctl)] border px-3 py-2 text-left transition ${t.side === 'sell' ? 'border-loss bg-loss/15' : 'border-ink-700 hover:border-ink-600'}`}>
          <div className="text-[12px] text-fg-2">Sell</div>
          <div className="type-data text-[17px] font-semibold text-loss-fg">{fmtPrice(t.bid, inst.digits)}</div>
        </button>
        <button type="button" onClick={() => t.setSide('buy')} aria-pressed={t.side === 'buy'} className={`rounded-[var(--radius-ctl)] border px-3 py-2 text-right transition ${t.side === 'buy' ? 'border-profit bg-profit/15' : 'border-ink-700 hover:border-ink-600'}`}>
          <div className="text-[12px] text-fg-2">Buy</div>
          <div className="type-data text-[17px] font-semibold text-profit-fg">{fmtPrice(t.ask, inst.digits)}</div>
        </button>
      </div>
      <Segmented
        label="Order type"
        value={t.kind}
        onChange={(v) => {
          t.setKind(v);
          if (v !== 'market' && !t.entryIn && Number.isFinite(t.bid)) t.setEntryIn(String(t.roundP(t.bid)));
        }}
        options={[
          { value: 'market', label: 'Market' },
          { value: 'limit', label: 'Limit' },
          { value: 'stop', label: 'Stop' },
        ]}
      />
      {t.kind !== 'market' && <PriceInput label="Entry price" value={t.entryIn} onChange={t.setEntryIn} onPick={() => t.setClickTarget('entry')} picking={t.clickTarget === 'entry'} />}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[13px] text-fg-2">Stop loss</span>
          <UnitToggle
            value={t.slMode}
            options={[
              ['pips', 'Pips'],
              ['price', 'Price'],
            ]}
            onChange={(v) => {
              if (v === t.slMode) return;
              if (t.slPrice !== undefined && Number.isFinite(t.entryRef)) t.setSlIn(v === 'price' ? String(t.roundP(t.slPrice)) : (Math.abs(t.entryRef - t.slPrice) / inst.pipSize).toFixed(1));
              t.setSlMode(v as 'pips' | 'price');
            }}
          />
        </div>
        <PriceInput value={t.slIn} onChange={t.setSlIn} onPick={() => t.setClickTarget('sl')} picking={t.clickTarget === 'sl'} />
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[13px] text-fg-2">Take profit</span>
          <UnitToggle
            value={t.tpMode}
            options={[
              ['r', 'R multiple'],
              ['price', 'Price'],
            ]}
            onChange={(v) => {
              if (v === t.tpMode) return;
              if (t.tpPrice !== undefined) t.setTpIn(v === 'price' ? String(t.roundP(t.tpPrice)) : t.rr ? t.rr.toFixed(2) : '2');
              t.setTpMode(v as 'r' | 'price');
            }}
          />
        </div>
        <PriceInput value={t.tpIn} onChange={t.setTpIn} onPick={() => t.setClickTarget('tp')} picking={t.clickTarget === 'tp'} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Risk %">
          <input type="number" step="0.1" className="field type-data" value={t.riskIn} onChange={(e) => t.setRiskIn(e.target.value)} />
        </Field>
        <Field label={inst.minLot >= 1 ? 'Contracts' : 'Size (lots)'}>
          <input type="number" step={inst.lotStep} className="field type-data" placeholder={t.sizing ? fmtLots(t.sizing.lots) : 'Auto'} value={t.lotsIn} onChange={(e) => t.setLotsIn(e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-2 rounded-[var(--radius-ctl)] bg-ink-950 px-3 py-2 text-[12px] type-data">
        <div>
          <div className="text-fg-3">Risk</div>
          <div className="font-semibold text-fg">{t.riskMoney !== null ? money(t.riskMoney, currency) : '—'}</div>
        </div>
        <div>
          <div className="text-fg-3">Reward : risk</div>
          <div className="font-semibold text-fg">{t.rr ? `${t.rr.toFixed(2)} : 1` : '—'}</div>
        </div>
        <div>
          <div className="text-fg-3">Stop</div>
          <div className="font-semibold text-fg">{t.slPrice !== undefined && Number.isFinite(t.entryRef) ? `${(Math.abs(t.entryRef - t.slPrice) / inst.pipSize).toFixed(1)} pips` : '—'}</div>
        </div>
      </div>
      <Button variant={t.side === 'buy' ? 'buy' : 'sell'} size="lg" className="w-full" onClick={onPlace} disabled={disabled}>
        {t.side === 'buy' ? 'Buy' : 'Sell'} {t.orderLots > 0 ? `${fmtLots(t.orderLots)} ${inst.minLot >= 1 ? (t.orderLots === 1 ? 'contract' : 'contracts') : 'lots'}` : ''} {t.kind === 'market' ? 'at market' : t.kind}
      </Button>
    </div>
  );
}
