import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Candle, TradeRecord } from '../core/types';
import { ReplayEngine, type ReplayEvent } from '../core/replay';
import { buildAggregation, lastBaseOf, partialBar, visibleBars, type Aggregation } from '../core/resample';
import { bucketStart, formatDate, formatDateTime, formatDuration, sessionOf, tfLabel, zonedParts, zonedToUtc } from '../core/time';
import { DEFAULT_SPREAD_PIPS, displaySymbol, SYMBOL_INFO, symbolFromTradingView } from '../core/instruments';
import { normaliseIndicators, type IndicatorConfig } from '../core/indicators';
import { computeStats } from '../core/stats';
import { useApp } from '../state/AppContext';
import type { DatasetMeta, SessionRecord } from '../store/db';
import { CandleChart, type CandleChartHandle, type ChartMarker, type PriceLineSpec } from '../components/CandleChart';
import { Button, EmptyState } from '../components/ui';
import { TradeForm } from '../components/TradeForm';
import { lots as fmtLots, money, pct, plural, pnlClass, price as fmtPrice, rMult, uid } from '../lib/format';
import { chartPalette, useTheme, withAlpha } from '../lib/theme';
import { TopBar, tfShort } from './TopBar';
import { ToolRail } from './ToolRail';
import { ReplayBar } from './ReplayBar';
import { Watchlist, bestDataset, canonical, Monogram } from './Watchlist';
import { OrderTicket, useTicket } from './OrderTicket';
import { HistoryTable, JournalTab, Metric, OrdersTable, PositionsTable, SessionsList, TradingPanel, closedToRecord, type BottomTab } from './TradingPanel';
import { SymbolSearch } from './SymbolSearch';
import { Dropdown } from './Dropdown';
import { useDrawingTool } from './useDrawingTool';
import type { Drawing, DrawingStyle, Formatters, LayerState, ToolId } from './drawings';
import { positionStats } from './drawings';
import { IGear, IList, ITicket } from './toolIcons';
import { IconJournal } from '../components/icons';

/* ------------------------------------------------------------------ */
/* Page: decides which market and which replay session to show          */
/* ------------------------------------------------------------------ */

export function TerminalPage() {
  const { param, sessions, datasets, settings, loadCandles, go } = useApp();
  // A link to a session that is not in this account (deleted, or another account's) opens the chart instead.
  const session = param && !param.startsWith('d-') ? sessions.find((s) => s.id === param) : undefined;
  const wanted = session?.datasetId ?? (param?.startsWith('d-') ? param.slice(2) : undefined) ?? settings.terminal?.datasetId;
  const fallback = useMemo(() => {
    for (const w of settings.watchlist) {
      const d = bestDataset(datasets, symbolFromTradingView(w.tv));
      if (d) return d;
    }
    return datasets[0];
  }, [datasets, settings.watchlist]);
  const dataset: DatasetMeta | undefined = datasets.find((d) => d.id === wanted) ?? fallback;
  const [loaded, setLoaded] = useState<{ id: string; candles: Candle[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!dataset) return;
    let alive = true;
    setError(null);
    loadCandles(dataset.id)
      .then((c) => alive && setLoaded({ id: dataset.id, candles: c }))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [dataset?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!dataset)
    return (
      <Centered>
        <EmptyState title="No candle data yet" actions={<Button variant="primary" onClick={() => go('data')}>Import candles</Button>}>
          Import a CSV from MetaTrader or TradingView, or download candles on the Markets page.
        </EmptyState>
      </Centered>
    );
  if (error)
    return (
      <Centered>
        <EmptyState title="Could not open these candles" actions={<Button onClick={() => go('data')}>Go to your data</Button>}>
          {error}
        </EmptyState>
      </Centered>
    );
  if (!loaded || loaded.id !== dataset.id)
    return (
      <Centered>
        <p className="text-fg-3">Loading candles…</p>
      </Centered>
    );
  return <Workspace key={`${dataset.id}:${session?.id ?? 'chart'}`} dataset={dataset} candles={loaded.candles} session={session ?? null} />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-dvh items-center justify-center p-6">{children}</div>;
}

/* ------------------------------------------------------------------ */
/* Workspace                                                           */
/* ------------------------------------------------------------------ */

const KIND_LABEL: Record<Drawing['kind'], string> = {
  trend: 'Trend line',
  ray: 'Ray',
  hline: 'Horizontal line',
  vline: 'Vertical line',
  rect: 'Rectangle',
  fib: 'Fib retracement',
  long: 'Long position',
  short: 'Short position',
  measure: 'Measure',
  text: 'Text note',
};

const lastTime = (d: Drawing) => Math.max(d.a.t, d.b?.t ?? -Infinity);

function Workspace({ dataset, candles, session }: { dataset: DatasetMeta; candles: Candle[]; session: SessionRecord | null }) {
  const { settings, pricing, instrumentFor, saveSession, saveTrades, trades, sessions, deleteSession, toast, go, updateSettings, confirm, datasets } = useApp();
  const tz = settings.timezone;
  const currency = settings.accountCurrency;
  const symbol = canonical(session?.symbol ?? dataset.symbol);
  const label = displaySymbol(symbol);
  const inst = useMemo(() => instrumentFor(symbol), [instrumentFor, symbol]);
  const replay = !!session;
  const baseTf = useMemo(() => {
    let best = Infinity;
    for (let i = 1; i < Math.min(candles.length, 500); i++) best = Math.min(best, candles[i].time - candles[i - 1].time);
    return Number.isFinite(best) ? best : 60;
  }, [candles]);

  const [tfSec, setTfSec] = useState(() => {
    const saved = settings.terminal?.datasetId === dataset.id ? settings.terminal.tfSec : undefined;
    return Math.max(baseTf, session?.displayTfSec ?? saved ?? 3600);
  });
  const tfRef = useRef(tfSec);
  tfRef.current = tfSec;
  const agg: Aggregation = useMemo(() => buildAggregation(candles, tfSec), [candles, tfSec]);
  const chart = useRef<CandleChartHandle>(null);
  const [apiVersion, setApiVersion] = useState(0);
  const lastGroup = useRef(-1);
  const indicators = useMemo(() => normaliseIndicators(settings.indicators), [settings.indicators]);

  // ---- panels ----
  const [rightTab, setRightTab] = useState<'watchlist' | 'trade' | null>(replay ? 'trade' : 'watchlist');
  const [bottomTab, setBottomTab] = useState<BottomTab>(replay ? 'positions' : 'journal');
  const [bottomOpen, setBottomOpen] = useState(true);
  const [search, setSearch] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [editingTrade, setEditingTrade] = useState<TradeRecord | null>(null);
  const [newTrade, setNewTrade] = useState(false);

  // ---- replay engine ----
  const engineRef = useRef<ReplayEngine | null>(null);
  if (session && !engineRef.current) engineRef.current = new ReplayEngine(candles, { instrument: inst, pricing, ...session.config }, session.state);
  const engine = engineRef.current;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [, setTick] = useState(0);
  const refresh = () => setTick((t) => t + 1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);
  const [unit, setUnit] = useState<'bar' | 'base'>('bar');
  const ticket = useTicket(engine, inst, pricing, { riskPct: session?.config.riskPct ?? settings.defaultRiskPct, commissionPerLot: session?.config.commissionPerLot ?? settings.defaultCommission });

  // ---- drawings ----
  const [drawings, setDrawings] = useState<Drawing[]>(() => session?.drawings ?? settings.drawings?.[symbol] ?? []);
  const drawingsRef = useRef(drawings);
  drawingsRef.current = drawings;
  const notesRef = useRef(session?.notes ?? '');
  const [selected, setSelected] = useState<string | null>(null);
  const [tool, setTool] = useState<ToolId>('cursor');
  const [magnet, setMagnet] = useState(false);
  const [stay, setStay] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [textEdit, setTextEdit] = useState<{ id: string; text: string } | null>(null);

  // ---- persistence ----
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(
    (status?: SessionRecord['status']) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = null;
      const s = sessionRef.current;
      const e = engineRef.current;
      if (!s || !e) return;
      void saveSession({ ...s, state: e.snapshot(), cursorTime: e.candle.time, displayTfSec: tfRef.current, drawings: drawingsRef.current, notes: notesRef.current, status: status ?? s.status, updatedAt: Date.now() });
    },
    [saveSession],
  );
  const persistSoon = useCallback(() => {
    if (!sessionRef.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => flush(), 900);
  }, [flush]);
  useEffect(
    () => () => {
      if (saveTimer.current) flush();
    },
    [flush],
  );

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const commitDrawings = useCallback(
    (list: Drawing[]) => {
      setDrawings(list);
      drawingsRef.current = list;
      if (sessionRef.current) persistSoon();
      else updateSettings({ drawings: { ...(settingsRef.current.drawings ?? {}), [symbol]: list } });
    },
    [persistSoon, updateSettings, symbol],
  );

  // Remember the market and timeframe for next time (chart mode only).
  useEffect(() => {
    if (replay) return;
    const t = settingsRef.current.terminal;
    if (t?.datasetId !== dataset.id || t?.tfSec !== tfSec) updateSettings({ terminal: { datasetId: dataset.id, tfSec } });
  }, [dataset.id, tfSec, replay]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- chart data ----
  const symbolTrades = useMemo(() => trades.filter((t) => canonical(t.symbol) === symbol), [trades, symbol]);

  const markersAndLines = useCallback(() => {
    const ch = chart.current;
    if (!ch) return;
    const pal = chartPalette();
    const ms: ChartMarker[] = [];
    const e = engineRef.current;
    if (e) {
      for (const t of e.closed.slice(-150)) {
        ms.push({ time: bucketStart(t.entryTime, tfSec), position: t.side === 'buy' ? 'belowBar' : 'aboveBar', shape: t.side === 'buy' ? 'arrowUp' : 'arrowDown', color: t.side === 'buy' ? pal.up : pal.down });
        ms.push({ time: bucketStart(t.exitTime, tfSec), position: t.side === 'buy' ? 'aboveBar' : 'belowBar', shape: 'circle', color: pal.exit, text: rMult(t.rMultiple, 1) });
      }
      for (const p of e.positions) ms.push({ time: bucketStart(p.entryTime, tfSec), position: p.side === 'buy' ? 'belowBar' : 'aboveBar', shape: p.side === 'buy' ? 'arrowUp' : 'arrowDown', color: p.side === 'buy' ? pal.up : pal.down, text: fmtLots(p.lots) });
    } else {
      // Chart mode: your journal's trades on this market, where they fall inside the data.
      const lo = candles[0]?.time ?? 0;
      const hi = (candles[candles.length - 1]?.time ?? 0) + baseTf;
      for (const t of symbolTrades.slice(-300)) {
        if (t.entryTime < lo || t.exitTime > hi) continue;
        ms.push({ time: bucketStart(t.entryTime, tfSec), position: t.side === 'buy' ? 'belowBar' : 'aboveBar', shape: t.side === 'buy' ? 'arrowUp' : 'arrowDown', color: t.side === 'buy' ? pal.up : pal.down });
        ms.push({ time: bucketStart(t.exitTime, tfSec), position: t.side === 'buy' ? 'aboveBar' : 'belowBar', shape: 'circle', color: pal.exit, text: rMult(t.rMultiple, 1) });
      }
    }
    ch.setMarkers(ms);
  }, [tfSec, candles, baseTf, symbolTrades]);

  const { theme } = useTheme();
  const seenTheme = useRef(theme);
  useEffect(() => {
    if (seenTheme.current === theme) return;
    seenTheme.current = theme;
    markersAndLines();
  }, [theme, markersAndLines]);

  // Markers are refreshed through a ref, so saving a journal entry never resets the chart's zoom.
  const markersRef = useRef(markersAndLines);
  markersRef.current = markersAndLines;
  const sync = useCallback(
    (full = false) => {
      const ch = chart.current;
      if (!ch) return;
      const e = engineRef.current;
      if (!e) {
        ch.setBars(agg.bars, 'reset');
        markersRef.current();
        return;
      }
      const cur = e.cursor;
      const g = agg.groupOf[cur];
      if (!full && lastGroup.current >= 0 && g === lastGroup.current) {
        ch.updateBar(partialBar(candles, agg, cur));
      } else if (!full && lastGroup.current >= 0 && g === lastGroup.current + 1) {
        ch.updateBar(agg.bars[lastGroup.current]);
        ch.updateBar(partialBar(candles, agg, cur));
      } else {
        ch.setBars(visibleBars(candles, agg, cur), full || lastGroup.current < 0 ? 'reset' : 'follow');
      }
      lastGroup.current = g;
      markersRef.current();
    },
    [agg, candles],
  );

  useEffect(() => {
    lastGroup.current = -1;
    sync(true);
  }, [sync]);

  useEffect(() => {
    markersAndLines();
  }, [markersAndLines]);

  // ---- replay events ----
  const handleEvents = useCallback(
    (events: ReplayEvent[]) => {
      const s = sessionRef.current;
      if (!events.length || !s) return;
      const records: TradeRecord[] = [];
      for (const ev of events) {
        if (ev.type === 'closed') {
          records.push(closedToRecord(ev.trade, s));
          const how = ev.trade.exitReason === 'tp' ? 'Take profit hit' : ev.trade.exitReason === 'sl' ? 'Stop loss hit' : 'Position closed';
          toast(`${how}: ${rMult(ev.trade.rMultiple, 1)} (${money(ev.trade.pnl, currency, { signed: true })}). Journal it in the bottom panel.`, ev.trade.pnl >= 0 ? 'success' : 'info');
        } else if (ev.type === 'filled') {
          toast(`${ev.order.side === 'buy' ? 'Buy' : 'Sell'} ${ev.order.kind} filled at ${fmtPrice(ev.position.entryPrice, inst.digits)}`);
        }
      }
      if (records.length) void saveTrades(records);
    },
    [currency, inst.digits, saveTrades, toast],
  );

  const afterChange = useCallback(
    (events: ReplayEvent[] = []) => {
      handleEvents(events);
      sync();
      persistSoon();
      refresh();
    },
    [handleEvents, sync, persistSoon],
  );

  const stepOnce = useCallback(() => {
    const e = engineRef.current;
    if (!e) return;
    if (e.atEnd) {
      setPlaying(false);
      return;
    }
    let events: ReplayEvent[];
    if (unit === 'bar' && agg.tfSec > baseTf) {
      const g = agg.groupOf[e.cursor];
      const endOfG = lastBaseOf(agg, g, candles.length);
      const target = e.cursor >= endOfG ? lastBaseOf(agg, Math.min(g + 1, agg.bars.length - 1), candles.length) : endOfG;
      events = e.stepTo(target);
    } else events = e.step(1);
    afterChange(events);
    if (e.atEnd) {
      setPlaying(false);
      toast('You reached the end of the data. Finish the session to close open trades.');
    }
  }, [unit, agg, baseTf, candles.length, afterChange, toast]);

  const stepMany = (n: number) => {
    for (let i = 0; i < n; i++) stepOnce();
  };

  const jump = (target: 'london' | 'ny' | 'day') => {
    const e = engineRef.current;
    if (!e) return;
    const want = target === 'london' ? 'London' : 'London–NY overlap';
    const startDay = zonedParts(e.now, tz);
    let idx = -1;
    let prev = sessionOf(candles[e.cursor].time);
    for (let i = e.cursor + 1; i < candles.length; i++) {
      if (target === 'day') {
        const p = zonedParts(candles[i].time, tz);
        if (p.day !== startDay.day || p.month !== startDay.month) {
          idx = i;
          break;
        }
        continue;
      }
      const s = sessionOf(candles[i].time);
      if (s === want && prev !== want) {
        idx = i;
        break;
      }
      prev = s;
    }
    if (idx < 0) {
      toast('Not found before the end of the data.');
      return;
    }
    afterChange(e.stepTo(Math.max(e.cursor, idx - 1)));
  };

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(stepOnce, 1000 / speed);
    return () => clearInterval(id);
  }, [playing, speed, stepOnce]);

  // ---- keyboard ----
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const tag = (ev.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || editingTrade || newTrade || search) return;
      if (ev.key === 'Escape' && selecting) {
        setSelecting(false);
        return;
      }
      if (ev.altKey) {
        const map: Record<string, ToolId> = { KeyT: 'trend', KeyH: 'hline', KeyV: 'vline', KeyF: 'fib' };
        if (map[ev.code]) {
          ev.preventDefault();
          setTool(map[ev.code]);
        }
        return;
      }
      if (!engineRef.current) return;
      if (ev.key === ' ') {
        ev.preventDefault();
        setPlaying((p) => !p);
      } else if (ev.key === 'ArrowRight') {
        ev.preventDefault();
        if (ev.shiftKey) stepMany(10);
        else stepOnce();
      } else if (ev.key === 'Escape') ticket.setClickTarget(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---- orders ----
  const place = () => {
    const e = engineRef.current;
    if (!e) return;
    const t = ticket;
    if (!(t.orderLots > 0)) {
      toast('Set a stop loss so the size can be calculated, or type a size.', 'error');
      return;
    }
    const res = e.placeOrder({
      side: t.side,
      kind: t.kind,
      price: t.kind === 'market' ? undefined : t.roundP(t.entryRef),
      lots: t.orderLots,
      sl: t.slPrice !== undefined ? t.roundP(t.slPrice) : undefined,
      tp: t.tpPrice !== undefined ? t.roundP(t.tpPrice) : undefined,
    });
    if (!res.ok) {
      toast(res.error, 'error');
      return;
    }
    toast(t.kind === 'market' ? `${t.side === 'buy' ? 'Bought' : 'Sold'} ${fmtLots(t.orderLots)} at ${fmtPrice(t.side === 'buy' ? e.ask : e.bid, inst.digits)}` : `${t.side === 'buy' ? 'Buy' : 'Sell'} ${t.kind} placed at ${fmtPrice(t.entryRef, inst.digits)}`, 'success');
    setBottomTab(t.kind === 'market' ? 'positions' : 'orders');
    setBottomOpen(true);
    afterChange(res.events);
  };

  // Price lines: open positions, pending orders and the order being prepared.
  useEffect(() => {
    const ch = chart.current;
    if (!ch) return;
    const e = engineRef.current;
    const ls: PriceLineSpec[] = [];
    const pal = chartPalette();
    if (e) {
      for (const p of e.positions) {
        ls.push({ price: p.entryPrice, color: pal.exit, title: `${p.side === 'buy' ? 'Long' : 'Short'} ${fmtLots(p.lots)}`, style: 'solid' });
        if (p.sl !== undefined) ls.push({ price: p.sl, color: pal.down, title: 'SL', style: 'solid' });
        if (p.tp !== undefined) ls.push({ price: p.tp, color: pal.up, title: 'TP', style: 'solid' });
      }
      for (const o of e.pending) {
        ls.push({ price: o.price, color: pal.pending, title: `${o.side === 'buy' ? 'Buy' : 'Sell'} ${o.kind}`, style: 'dashed' });
        if (o.sl !== undefined) ls.push({ price: o.sl, color: withAlpha(pal.down, 0.65), title: 'SL', style: 'dashed' });
        if (o.tp !== undefined) ls.push({ price: o.tp, color: withAlpha(pal.up, 0.65), title: 'TP', style: 'dashed' });
      }
      if (rightTab === 'trade') {
        if (ticket.kind !== 'market' && Number.isFinite(ticket.entryRef)) ls.push({ price: ticket.entryRef, color: pal.draft, title: 'New entry', style: 'dotted' });
        if (ticket.slPrice !== undefined) ls.push({ price: ticket.slPrice, color: pal.draft, title: 'New SL', style: 'dotted' });
        if (ticket.tpPrice !== undefined) ls.push({ price: ticket.tpPrice, color: pal.draft, title: 'New TP', style: 'dotted' });
      }
    }
    ch.setLines(ls);
  });

  // ---- drawing layer ----
  const style: DrawingStyle = useMemo(() => {
    const pal = chartPalette();
    return { line: pal.accent, up: pal.up, down: pal.down, text: pal.fg, labelBg: withAlpha(pal.surface, 0.92), surface: pal.surface, measure: pal.pending };
  }, [theme]); // eslint-disable-line react-hooks/exhaustive-deps
  const riskMoney = (engine ? engine.balance : settings.accountSize) * ((Number(ticket.riskIn) || settings.defaultRiskPct) / 100);
  const fmt: Formatters = useMemo(
    () => ({
      price: (p: number) => p.toFixed(inst.digits),
      pips: (d: number) => `${(d / inst.pipSize).toFixed(1)} ${inst.minLot >= 1 ? 'ticks' : 'pips'}`,
      riskMoney: settings.hideAmounts ? null : riskMoney,
      money: (v: number) => money(v, currency, { signed: true }),
      duration: (sec: number) => formatDuration(sec),
      bars: (t1: number, t2: number) => {
        const api = chart.current?.api();
        const x1 = api?.timeToX(t1);
        const x2 = api?.timeToX(t2);
        const spacing = api?.chart.timeScale().options().barSpacing ?? 6;
        return x1 != null && x2 != null ? Math.round(Math.abs(x2 - x1) / spacing) : 0;
      },
    }),
    [inst, currency, riskMoney, settings.hideAmounts],
  );
  const layerState: LayerState = { drawings, selected, draft: null, hidden, style, fmt, interactive: tool === 'cursor' };

  useDrawingTool({
    api: () => chart.current?.api() ?? null,
    apiVersion,
    tool,
    setTool,
    drawings,
    onChange: commitDrawings,
    selected,
    setSelected,
    magnet,
    hidden,
    stayInMode: stay,
    style,
    fmt,
    onTextNeeded: (d) => setTextEdit({ id: d.id, text: d.text ?? '' }),
  });

  const sel = drawings.find((d) => d.id === selected) ?? null;
  const removeSelected = () => {
    if (!sel) return;
    commitDrawings(drawings.filter((d) => d.id !== sel.id));
    setSelected(null);
  };

  // ---- replay start / exit ----
  const startReplayAt = async (time: number) => {
    const g = agg.bars.findIndex((b) => b.time === time);
    if (g < 0) return;
    const startIndex = lastBaseOf(agg, g, candles.length);
    if (startIndex >= candles.length - 2) {
      toast('Pick an earlier candle: the replay needs candles after it.', 'error');
      return;
    }
    const config = {
      startingBalance: Math.max(1, settings.accountSize),
      spreadPips: DEFAULT_SPREAD_PIPS[symbol] ?? 1,
      commissionPerLot: settings.defaultCommission,
      riskPct: settings.defaultRiskPct,
    };
    const eng = new ReplayEngine(candles, { instrument: inst, pricing, ...config }, undefined, startIndex);
    const cutoff = candles[startIndex].time + baseTf;
    const now = Date.now();
    const rec: SessionRecord = {
      id: uid('s'),
      name: `${label} ${tfLabel(tfSec)} from ${formatDate(candles[startIndex].time, tz)}`,
      datasetId: dataset.id,
      symbol,
      displayTfSec: tfSec,
      setup: '',
      config,
      state: eng.snapshot(),
      startIndex,
      cursorTime: candles[startIndex].time,
      status: 'active',
      // Drawings made before the start candle come along; anything later would show the future.
      drawings: drawings.filter((d) => d.kind !== 'measure' && lastTime(d) <= cutoff),
      notes: '',
      createdAt: now,
      updatedAt: now,
    };
    await saveSession(rec);
    setSelecting(false);
    toast('Replay started. Candles after this one are hidden: press Play or the right arrow to reveal them.', 'success');
    go('backtest', rec.id);
  };

  /** Start on a calendar date: the replay opens on the last candle before that day. */
  const startFromDate = (utc: number) => {
    const g = agg.bars.findIndex((b) => b.time >= utc);
    if (g <= 0) {
      toast(g === 0 ? 'Pick a later date: the replay needs at least one candle before the start.' : 'That date is after the end of the data.', 'error');
      return;
    }
    void startReplayAt(agg.bars[g - 1].time);
  };

  const exitReplay = () => {
    setPlaying(false);
    flush();
    go('backtest', `d-${dataset.id}`);
  };

  const onReplayButton = () => {
    if (replay) exitReplay();
    else if (selecting) setSelecting(false);
    else {
      setSelecting(true);
      setTool('cursor');
      setSelected(null);
    }
  };

  const finish = () => {
    const e = engineRef.current;
    if (!e) return;
    setPlaying(false);
    const events = e.closeAll('end');
    handleEvents(events);
    flush('finished');
    sync();
    refresh();
    toast(`Session finished: ${plural(e.closed.length, 'trade')}, ${rMult(e.closed.reduce((a, t) => a + (t.rMultiple ?? 0), 0), 1)}. Review them in the Journal tab.`, 'success');
    setBottomTab('journal');
    setBottomOpen(true);
  };

  const updateConfig = (patch: Partial<SessionRecord['config']> & { name?: string; setup?: string }) => {
    const s = sessionRef.current;
    const e = engineRef.current;
    if (!s || !e) return;
    const { name, setup, ...cfg } = patch;
    const config = { ...s.config, ...cfg };
    if (Object.keys(cfg).length) engineRef.current = new ReplayEngine(candles, { instrument: inst, pricing, ...config }, e.snapshot());
    const next = { ...s, name: name ?? s.name, setup: setup ?? s.setup, config, state: engineRef.current!.snapshot(), drawings: drawingsRef.current, notes: notesRef.current, updatedAt: Date.now() };
    sessionRef.current = next;
    void saveSession(next);
    refresh();
    toast('Replay settings saved', 'success');
  };

  const changeTf = (sec: number) => {
    setTfSec(sec);
    tfRef.current = sec;
    persistSoon();
  };

  const openMarket = (_symbol: string, d?: DatasetMeta) => {
    if (!d) {
      setRightTab('watchlist');
      return;
    }
    if (d.id === dataset.id && !replay) return;
    if (replay) flush();
    go('backtest', `d-${d.id}`);
  };

  // ---- derived numbers ----
  const closedRecords = useMemo(() => (engine && session ? engine.closed.map((t) => closedToRecord(t, session)) : []), [engine, session, engine?.closed.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const st = session ? computeStats(closedRecords, session.config.startingBalance) : null;
  const openPnl = engine ? engine.positions.reduce((a, p) => a + engine.unrealized(p), 0) : 0;
  const replayTime = engine ? engine.candle.time + baseTf : 0;
  const progress = engine && session ? (engine.cursor - session.startIndex) / Math.max(1, candles.length - 1 - session.startIndex) : 0;
  const journalById = useMemo(() => new Map(trades.map((t) => [t.id, t])), [trades]);
  const sessionTrades = useMemo(() => (session ? trades.filter((t) => t.sessionId === session.id) : []), [trades, session]);
  const unjournaled = (replay ? sessionTrades : symbolTrades).filter((t) => !t.notes && !t.mistakes.length && !t.rating).length;
  const info = SYMBOL_INFO[symbol];
  const dataLabel = dataset.builtIn ? 'Sample data' : dataset.sync ? 'Downloaded' : 'Imported';

  const legendTitle = (
    <span className="flex items-center gap-2">
      <Monogram symbol={symbol} size={18} />
      <span className="font-semibold text-fg">{label}</span>
      <span className="text-fg-2">{tfShort(tfSec)}</span>
      <span className="text-fg-3">{replay ? 'Replay' : dataLabel}</span>
    </span>
  );
  const quickTrade =
    replay && engine ? (
      <div className="flex items-stretch gap-px overflow-hidden rounded-[var(--radius-ctl)] text-[12px] shadow-sm">
        <button
          type="button"
          onClick={() => {
            ticket.setSide('sell');
            setRightTab('trade');
          }}
          className="bg-loss-strong px-2.5 py-1 text-left text-white transition hover:brightness-110"
        >
          <span className="block text-[10px] opacity-80">SELL</span>
          <span className="type-data font-semibold">{fmtPrice(engine.bid, inst.digits)}</span>
        </button>
        <span className="type-data flex items-center bg-ink-900 px-2 text-[11px] text-fg-2" title="Spread in pips">
          {((engine.ask - engine.bid) / inst.pipSize).toFixed(1)}
        </span>
        <button
          type="button"
          onClick={() => {
            ticket.setSide('buy');
            setRightTab('trade');
          }}
          className="bg-profit px-2.5 py-1 text-right text-profit-ink transition hover:brightness-110"
        >
          <span className="block text-[10px] opacity-80">BUY</span>
          <span className="type-data font-semibold">{fmtPrice(engine.ask, inst.digits)}</span>
        </button>
      </div>
    ) : null;

  const tabs: { id: BottomTab; label: string; badge?: number }[] = replay
    ? [
        { id: 'positions', label: 'Positions', badge: engine?.positions.length },
        { id: 'orders', label: 'Orders', badge: engine?.pending.length },
        { id: 'history', label: 'History', badge: engine?.closed.length },
        { id: 'journal', label: 'Journal', badge: unjournaled },
        { id: 'sessions', label: 'Replay sessions' },
      ]
    : [
        { id: 'journal', label: `Journal: ${label}`, badge: unjournaled },
        { id: 'sessions', label: 'Replay sessions', badge: sessions.length },
      ];

  const status = replay ? (
    <div className="hidden text-right leading-tight lg:block">
      <div className="type-data text-[13px] font-medium">{formatDateTime(replayTime, tz)}</div>
      <div className="max-w-[260px] truncate text-[11px] text-fg-3">
        {sessionOf(replayTime)}, {session!.name}
      </div>
    </div>
  ) : null;

  const gridCols = rightTab ? 'lg:grid-cols-[46px_minmax(0,1fr)_330px_44px]' : 'lg:grid-cols-[46px_minmax(0,1fr)_44px]';

  return (
    <div className="flex min-h-dvh flex-col gap-1 bg-ink-950 p-1 lg:h-dvh">
      <TopBar
        symbol={label}
        description={info?.description ?? dataset.name}
        onSymbolSearch={() => setSearch(true)}
        tfSec={tfSec}
        baseTf={baseTf}
        onTf={changeTf}
        indicators={indicators}
        onIndicators={(v: IndicatorConfig) => updateSettings({ indicators: v })}
        replay={replay ? 'on' : selecting ? 'selecting' : 'off'}
        onReplay={onReplayButton}
        status={status}
      />
      <div className={`flex min-h-0 flex-1 flex-col gap-1 lg:grid lg:grid-rows-[minmax(0,1fr)_auto] ${gridCols}`}>
        <div className="order-1 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <ToolRail
            tool={tool}
            setTool={(t) => {
              setTool(t);
              setSelecting(false);
            }}
            magnet={magnet}
            setMagnet={setMagnet}
            stay={stay}
            setStay={setStay}
            hidden={hidden}
            setHidden={setHidden}
            count={drawings.length}
            onClear={async () => {
              if (!drawings.length) return;
              if (await confirm({ title: `Remove all ${plural(drawings.length, 'drawing')}?`, body: replay ? 'From this replay session.' : `From the ${label} chart.`, confirmLabel: 'Remove all', danger: true })) {
                commitDrawings([]);
                setSelected(null);
              }
            }}
          />
        </div>

        <div className="relative order-2 h-[62vh] min-h-[360px] overflow-hidden rounded-[var(--radius-panel)] border border-ink-700 lg:col-start-2 lg:row-start-1 lg:h-auto lg:min-h-0" style={{ background: 'var(--chart-bg)' }}>
          <CandleChart
            ref={chart}
            digits={inst.digits}
            tz={tz}
            tfSec={tfSec}
            indicators={indicators}
            title={legendTitle}
            legendExtra={quickTrade}
            layerState={layerState}
            onReady={() => {
              lastGroup.current = -1;
              sync(true);
              setApiVersion((v) => v + 1);
            }}
            onPriceClick={replay ? ticket.onChartPick : undefined}
            clickHint={
              selecting
                ? null
                : ticket.clickTarget
                  ? `Click the chart to set the ${ticket.clickTarget === 'entry' ? 'entry price' : ticket.clickTarget === 'sl' ? 'stop loss' : 'take profit'} (Esc to cancel)`
                  : null
            }
            onSelectBar={selecting ? (t) => void startReplayAt(t) : null}
          />

          {selecting && <StartPicker tz={tz} first={candles[0].time} last={candles[candles.length - 1].time} onPick={startFromDate} onCancel={() => setSelecting(false)} />}

          {sel && tool === 'cursor' && !hidden && (
            <div className="absolute left-1/2 top-12 z-[6] flex -translate-x-1/2 items-center gap-1 rounded-[var(--radius-panel)] border border-ink-600 bg-ink-900/95 p-1 text-[13px] shadow-xl" role="toolbar" aria-label="Selected drawing">
              <span className="px-2 text-fg-2">{KIND_LABEL[sel.kind]}</span>
              {(sel.kind === 'long' || sel.kind === 'short') && (
                <span className="type-data px-1 text-fg-3">R:R {positionStats(sel).rr.toFixed(2)}</span>
              )}
              {(sel.kind === 'long' || sel.kind === 'short') && replay && (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    ticket.fromPosition(sel.kind === 'long', sel.a.p, sel.stop!, sel.target!);
                    setRightTab('trade');
                    toast('Order panel filled from the position tool. Check it and place the order.');
                  }}
                >
                  Use for an order
                </Button>
              )}
              {sel.kind === 'text' && (
                <Button size="sm" variant="ghost" onClick={() => setTextEdit({ id: sel.id, text: sel.text ?? '' })}>
                  Edit text
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={removeSelected} title="Delete (Del)">
                Delete
              </Button>
            </div>
          )}

          {textEdit && (
            <form
              className="absolute left-1/2 top-12 z-[7] flex w-[min(420px,90%)] -translate-x-1/2 items-center gap-2 rounded-[var(--radius-panel)] border border-ink-600 bg-ink-900 p-2 shadow-2xl"
              onSubmit={(e) => {
                e.preventDefault();
                commitDrawings(drawings.map((d) => (d.id === textEdit.id ? { ...d, text: textEdit.text.trim() || 'Note' } : d)));
                setTextEdit(null);
              }}
            >
              <input autoFocus className="field h-8 min-h-0 py-0 text-[13px]" placeholder="Note on the chart, e.g. Asia high swept" value={textEdit.text} onChange={(e) => setTextEdit({ ...textEdit, text: e.target.value })} aria-label="Note text" />
              <Button size="sm" variant="primary" type="submit">
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setTextEdit(null)}>
                Cancel
              </Button>
            </form>
          )}

          {replay && engine && (
            <div className="absolute bottom-9 left-1/2 z-[5] -translate-x-1/2">
              <ReplayBar
                playing={playing}
                onPlay={() => setPlaying((p) => !p)}
                onStep={stepOnce}
                onStepMany={() => stepMany(10)}
                speed={speed}
                onSpeed={setSpeed}
                unitLabel={tfSec > baseTf ? { bar: tfShort(tfSec), base: tfShort(baseTf) } : undefined}
                unit={unit}
                onUnit={setUnit}
                onJump={jump}
                progress={progress}
                atEnd={engine.atEnd}
                onExit={exitReplay}
              />
            </div>
          )}
        </div>

        <div className="order-5 lg:col-start-2 lg:row-start-2">
          <TradingPanel
            open={bottomOpen}
            setOpen={setBottomOpen}
            tab={bottomTab}
            setTab={setBottomTab}
            tabs={tabs}
            summary={
              replay && engine && st ? (
                <div className="hidden items-center gap-4 md:flex">
                  <Metric label="Balance" value={money(engine.balance, currency)} />
                  <Metric label="Equity" value={money(engine.equity(), currency)} />
                  <Metric label="Open P&L" value={money(openPnl, currency, { signed: true })} className={pnlClass(openPnl)} />
                  <Metric label="Closed P&L" value={money(st.netPnl, currency, { signed: true })} className={pnlClass(st.netPnl)} />
                  <Metric label="Trades" value={`${st.trades}${st.trades ? `, ${pct(st.winRate, 0)} won` : ''}`} />
                  <Metric label="Net R" value={rMult(st.totalR, 1)} className={pnlClass(st.totalR)} />
                </div>
              ) : !replay ? (
                <span className="hidden text-[12px] text-fg-3 md:inline">Press Replay to trade this chart candle by candle</span>
              ) : null
            }
            actions={
              replay && session ? (
                <div className="flex items-center gap-1">
                  <SessionSettings session={sessionRef.current ?? session} canChangeBalance={!engine?.closed.length && !engine?.positions.length} onSave={updateConfig} />
                  <Button size="sm" variant="outline" onClick={finish}>
                    {session.status === 'finished' ? 'Close open trades' : 'Finish session'}
                  </Button>
                </div>
              ) : null
            }
          >
            {bottomTab === 'positions' && engine && <PositionsTable engine={engine} inst={inst} currency={currency} onEvents={(e) => afterChange(e)} onError={(m) => toast(m, 'error')} />}
            {bottomTab === 'orders' && engine && (
              <OrdersTable
                engine={engine}
                inst={inst}
                tz={tz}
                onCancel={(id) => {
                  engine.cancelOrder(id);
                  afterChange();
                }}
              />
            )}
            {bottomTab === 'history' && engine && session && <HistoryTable engine={engine} session={session} inst={inst} currency={currency} tz={tz} journal={journalById} onReview={setEditingTrade} />}
            {bottomTab === 'journal' &&
              (replay && session ? (
                <JournalTab
                  trades={sessionTrades}
                  currency={currency}
                  tz={tz}
                  notes={session.notes ?? ''}
                  notesLabel="Session plan and review"
                  onNotes={(v) => {
                    notesRef.current = v;
                    flush();
                    toast('Notes saved', 'success');
                  }}
                  onReview={setEditingTrade}
                  emptyText="Trades you close in this replay appear here. Add the setup, how you felt, mistakes and notes to each one."
                />
              ) : (
                <JournalTab trades={symbolTrades} currency={currency} tz={tz} onReview={setEditingTrade} onNew={() => setNewTrade(true)} emptyText={`No ${label} trades in your journal yet. Replay this chart, or log a live trade.`} />
              ))}
            {bottomTab === 'sessions' && (
              <SessionsList
                sessions={sessions}
                current={session?.id}
                tz={tz}
                currency={currency}
                onOpen={(s) => {
                  flush();
                  go('backtest', s.id);
                }}
                onDelete={async (s) => {
                  if (await confirm({ title: `Delete "${s.name}"?`, body: 'Its trades stay in your journal.', confirmLabel: 'Delete session', danger: true })) {
                    if (s.id === session?.id) go('backtest', `d-${dataset.id}`);
                    await deleteSession(s.id);
                    toast('Session deleted');
                  }
                }}
              />
            )}
          </TradingPanel>
        </div>

        {rightTab && (
          <aside className="order-4 flex min-h-0 flex-col overflow-hidden rounded-[var(--radius-panel)] border border-ink-700 bg-ink-900 max-lg:max-h-[640px] lg:col-start-3 lg:row-span-2 lg:row-start-1" aria-label={rightTab === 'watchlist' ? 'Watchlist' : 'Order panel'}>
            {rightTab === 'watchlist' ? (
              <Watchlist current={symbol} onOpen={openMarket} />
            ) : replay && engine ? (
              <div className="min-h-0 overflow-y-auto">
                <div className="flex items-center justify-between px-3 pt-2.5">
                  <h2 className="text-[13px] font-semibold">Order: {label}</h2>
                  <span className="type-data text-[12px] text-fg-3">{money(engine.balance, currency)}</span>
                </div>
                <OrderTicket t={ticket} inst={inst} currency={currency} onPlace={place} disabled={engine.atEnd} />
              </div>
            ) : (
              <div className="space-y-3 p-4 text-[13px]">
                <h2 className="font-semibold">Trade in a replay</h2>
                <p className="text-fg-2">Orders work inside a replay, where the future candles are hidden. Press Replay, click the candle to start from, then buy or sell here.</p>
                <Button variant="primary" onClick={onReplayButton}>
                  Start a replay
                </Button>
              </div>
            )}
          </aside>
        )}

        <nav className={`order-3 flex gap-1 rounded-[var(--radius-panel)] border border-ink-700 bg-ink-900 p-1 lg:row-span-2 lg:row-start-1 lg:flex-col ${rightTab ? 'lg:col-start-4' : 'lg:col-start-3'}`} aria-label="Side panels">
          <RailToggle label="Watchlist" active={rightTab === 'watchlist'} onClick={() => setRightTab(rightTab === 'watchlist' ? null : 'watchlist')}>
            <IList size={20} />
          </RailToggle>
          <RailToggle label="Order panel" active={rightTab === 'trade'} onClick={() => setRightTab(rightTab === 'trade' ? null : 'trade')}>
            <ITicket size={20} />
          </RailToggle>
          <RailToggle
            label="Journal"
            active={bottomOpen && bottomTab === 'journal'}
            onClick={() => {
              setBottomTab('journal');
              setBottomOpen(true);
            }}
          >
            <IconJournal size={19} />
          </RailToggle>
        </nav>
      </div>

      <SymbolSearch
        open={search}
        onClose={() => setSearch(false)}
        onPickDataset={(d) => {
          setSearch(false);
          openMarket(canonical(d.symbol), d);
        }}
        onPickSymbol={(s) => {
          setSearch(false);
          const d = bestDataset(datasets, s);
          if (d) openMarket(s, d);
          else {
            setRightTab('watchlist');
            toast(`No ${displaySymbol(s)} candles yet. Download or import them from the watchlist panel.`);
          }
        }}
      />
      <TradeForm open={!!editingTrade} trade={editingTrade} onClose={() => setEditingTrade(null)} />
      <TradeForm open={newTrade} trade={null} symbol={symbol} onClose={() => setNewTrade(false)} />
    </div>
  );
}

function RailToggle({ label, active, onClick, children }: { label: string; active: boolean; onClick(): void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`flex h-9 w-9 items-center justify-center rounded-[var(--radius-ctl)] transition ${active ? 'bg-brass/15 text-brass-fg' : 'text-fg-2 hover:bg-ink-850 hover:text-fg'}`}
    >
      {children}
    </button>
  );
}

function SessionSettings({ session, canChangeBalance, onSave }: { session: SessionRecord; canChangeBalance: boolean; onSave(p: Partial<SessionRecord['config']> & { name?: string; setup?: string }): void }) {
  const { settings } = useApp();
  const [name, setName] = useState(session.name);
  const [setup, setSetup] = useState(session.setup);
  const [balance, setBalance] = useState(String(session.config.startingBalance));
  const [spread, setSpread] = useState(String(session.config.spreadPips));
  const [commission, setCommission] = useState(String(session.config.commissionPerLot));
  const [risk, setRisk] = useState(String(session.config.riskPct));
  return (
    <Dropdown
      align="right"
      up
      panelClass="w-[320px] p-3"
      trigger={(open, toggle) => (
        <button
          type="button"
          onClick={() => {
            if (!open) {
              setName(session.name);
              setSetup(session.setup);
              setBalance(String(session.config.startingBalance));
              setSpread(String(session.config.spreadPips));
              setCommission(String(session.config.commissionPerLot));
              setRisk(String(session.config.riskPct));
            }
            toggle();
          }}
          aria-expanded={open}
          className="flex h-8 items-center gap-1.5 rounded-[var(--radius-ctl)] px-2 text-[13px] text-fg-2 hover:bg-ink-850 hover:text-fg"
        >
          <IGear size={16} />
          Replay settings
        </button>
      )}
    >
      {(close) => (
        <form
          className="space-y-2.5 text-[13px]"
          onSubmit={(e) => {
            e.preventDefault();
            onSave({
              name: name.trim() || session.name,
              setup: setup.trim(),
              ...(canChangeBalance ? { startingBalance: Math.max(1, Number(balance) || session.config.startingBalance) } : {}),
              spreadPips: Math.max(0, Number(spread) || 0),
              commissionPerLot: Math.max(0, Number(commission) || 0),
              riskPct: Math.max(0.01, Number(risk) || session.config.riskPct),
            });
            close();
          }}
        >
          <label className="block">
            <span className="mb-1 block text-fg-2">Session name</span>
            <input className="field h-8 min-h-0 py-0" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-fg-2">Setup you are testing</span>
            <input className="field h-8 min-h-0 py-0" placeholder="London breakout" value={setup} onChange={(e) => setSetup(e.target.value)} />
            <span className="mt-1 block text-[11px] text-fg-3">New trades in this session are tagged with it.</span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-fg-2">Start balance ({settings.accountCurrency})</span>
              <input className="field type-data h-8 min-h-0 py-0" type="number" value={balance} disabled={!canChangeBalance} title={canChangeBalance ? undefined : 'Fixed once the session has trades'} onChange={(e) => setBalance(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-fg-2">Default risk %</span>
              <input className="field type-data h-8 min-h-0 py-0" type="number" step="0.1" value={risk} onChange={(e) => setRisk(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-fg-2">Spread (pips)</span>
              <input className="field type-data h-8 min-h-0 py-0" type="number" step="0.1" value={spread} onChange={(e) => setSpread(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-fg-2">Commission / lot</span>
              <input className="field type-data h-8 min-h-0 py-0" type="number" step="0.5" value={commission} onChange={(e) => setCommission(e.target.value)} />
            </label>
          </div>
          <Button type="submit" variant="primary" size="sm" className="w-full">
            Save settings
          </Button>
        </form>
      )}
    </Dropdown>
  );
}

function StartPicker({ tz, first, last, onPick, onCancel }: { tz: string; first: number; last: number; onPick(utc: number): void; onCancel(): void }) {
  const ymd = (t: number) => {
    const p = zonedParts(t, tz);
    return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  };
  const [date, setDate] = useState(() => ymd(first + (last - first) * 0.5));
  return (
    <form
      className="absolute left-1/2 top-14 z-[7] flex w-[min(560px,94%)] -translate-x-1/2 flex-wrap items-center gap-2 rounded-[var(--radius-panel)] border border-brass/60 bg-ink-900/95 px-3 py-2 text-[13px] shadow-2xl"
      onSubmit={(e) => {
        e.preventDefault();
        const [y, m, d] = date.split('-').map(Number);
        if (y) onPick(zonedToUtc(y, m, d, 0, 0, tz));
      }}
    >
      <span className="text-fg">Click the candle to start from, or pick a day:</span>
      <input type="date" className="field h-8 min-h-0 w-auto py-0 text-[13px]" value={date} min={ymd(first)} max={ymd(last)} onChange={(e) => setDate(e.target.value)} aria-label="Replay start date" />
      <Button size="sm" variant="primary" type="submit">
        Start there
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}
