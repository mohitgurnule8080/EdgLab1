import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  TickMarkType,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Candle } from '../core/types';
import { formatDateTime, monthName, zonedParts } from '../core/time';
import { Bollinger, DEFAULT_INDICATORS, Ema, Rsi, Sma, type IndicatorConfig } from '../core/indicators';
import { chartPalette, useTheme, withAlpha, type ChartPalette } from '../lib/theme';
import { DrawingsLayer, type LayerState } from '../terminal/drawings';

export interface PriceLineSpec {
  price: number;
  color: string;
  title: string;
  style?: 'solid' | 'dashed' | 'dotted';
  width?: 1 | 2;
}

export interface ChartMarker {
  time: number;
  position: 'aboveBar' | 'belowBar';
  shape: 'arrowUp' | 'arrowDown' | 'circle';
  color: string;
  text?: string;
}

/** What overlays (the drawing tools) need from the chart. */
export interface ChartApi {
  chart: IChartApi;
  series: ISeriesApi<'Candlestick'>;
  box: HTMLDivElement;
  layer: DrawingsLayer;
  bars(): Candle[];
  tfSec(): number;
  /** Time -> x in pixels; works past the last candle too. */
  timeToX(t: number): number | null;
  /** x in pixels -> time of the nearest candle (or of an empty slot after the last one). */
  xToTime(x: number): number | null;
  /** The candle at (or just before) a time, for the magnet. */
  barAt(t: number): Candle | undefined;
}

export interface CandleChartHandle {
  /** 'reset' shows the latest ~140 bars; 'follow' keeps the zoom level and scrolls to the newest bar. */
  setBars(bars: Candle[], mode?: 'reset' | 'follow'): void;
  updateBar(bar: Candle): void;
  setMarkers(markers: ChartMarker[]): void;
  setLines(lines: PriceLineSpec[]): void;
  showLatest(bars?: number): void;
  api(): ChartApi | null;
}

/** Theme-dependent chart options, applied at creation and again when day / night changes. */
function chartColours(p: ChartPalette) {
  return {
    layout: { background: { type: ColorType.Solid, color: p.bg }, textColor: p.text, panes: { separatorColor: p.border, separatorHoverColor: withAlpha(p.accent, 0.4) } },
    grid: { vertLines: { color: p.grid }, horzLines: { color: p.grid } },
    crosshair: { vertLine: { color: p.cross, labelBackgroundColor: p.label }, horzLine: { color: p.cross, labelBackgroundColor: p.label } },
    rightPriceScale: { borderColor: p.border },
    timeScale: { borderColor: p.border },
  };
}
const candleColours = (p: ChartPalette) => ({ upColor: p.up, downColor: p.down, wickUpColor: p.up, wickDownColor: p.down });

const toBar = (c: Candle) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close });
const pad = (n: number) => String(n).padStart(2, '0');

/* ------------------------------------------------------------------ */
/* Indicators                                                          */
/* ------------------------------------------------------------------ */

interface IndicatorSet {
  ma: { calc: Ema | Sma; series: ISeriesApi<'Line'>; label: string; color: string }[];
  bb?: { calc: Bollinger; upper: ISeriesApi<'Line'>; mid: ISeriesApi<'Line'>; lower: ISeriesApi<'Line'>; label: string; color: string };
  rsi?: { calc: Rsi; series: ISeriesApi<'Line'>; label: string; color: string };
  volume?: ISeriesApi<'Histogram'>;
}

export interface LegendValue {
  label: string;
  color: string;
  value: string;
}

function point(time: number, v: number) {
  return Number.isFinite(v) ? { time: time as UTCTimestamp, value: v } : { time: time as UTCTimestamp };
}

function buildIndicators(c: IChartApi, cfg: IndicatorConfig, pal: ChartPalette, digits: number): IndicatorSet {
  const fmt = { type: 'price' as const, precision: digits, minMove: 10 ** -digits };
  const line = (color: string, width: 1 | 2 = 2, pane = 0, style: LineStyle = LineStyle.Solid) =>
    c.addSeries(LineSeries, { color, lineWidth: width, lineStyle: style, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, priceFormat: fmt }, pane);
  const set: IndicatorSet = { ma: [] };
  cfg.ma.forEach((m, i) => {
    if (!m.on) return;
    set.ma.push({ calc: m.kind === 'ema' ? new Ema(m.period) : new Sma(m.period), series: line(pal.ma[i]), label: `${m.kind.toUpperCase()} ${m.period}`, color: pal.ma[i] });
  });
  if (cfg.bb.on) {
    const color = pal.band;
    set.bb = { calc: new Bollinger(cfg.bb.period, cfg.bb.mult), upper: line(color, 1), mid: line(color, 1, 0, LineStyle.Dashed), lower: line(color, 1), label: `BB ${cfg.bb.period} ${cfg.bb.mult}`, color };
  }
  if (cfg.volume) {
    set.volume = c.addSeries(HistogramSeries, { priceScaleId: 'volume', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    c.priceScale('volume').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
  }
  if (cfg.rsi.on) {
    const color = pal.ma[2];
    const s = c.addSeries(LineSeries, { color, lineWidth: 2, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false, priceFormat: { type: 'price', precision: 1, minMove: 0.1 } }, 1);
    for (const lvl of [70, 30]) s.createPriceLine({ price: lvl, color: pal.band, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '' });
    set.rsi = { calc: new Rsi(cfg.rsi.period), series: s, label: `RSI ${cfg.rsi.period}`, color };
    const panes = c.panes();
    if (panes[1]) panes[1].setHeight(Math.max(90, Math.round(c.paneSize(0).height * 0.28)));
  }
  return set;
}

function removeIndicators(c: IChartApi, set: IndicatorSet | null) {
  if (!set) return;
  const all: ISeriesApi<SeriesType>[] = [...set.ma.map((m) => m.series)];
  if (set.bb) all.push(set.bb.upper, set.bb.mid, set.bb.lower);
  if (set.rsi) all.push(set.rsi.series);
  if (set.volume) all.push(set.volume);
  for (const s of all) c.removeSeries(s);
  while (c.panes().length > 1) c.removePane(c.panes().length - 1);
}

function fillIndicators(set: IndicatorSet, bars: Candle[], pal: ChartPalette) {
  for (const m of set.ma) {
    m.calc.reset(bars);
    m.series.setData(bars.map((b, i) => point(b.time, m.calc.values[i])));
  }
  if (set.bb) {
    const bb = set.bb;
    bb.calc.reset(bars);
    bb.upper.setData(bars.map((b, i) => point(b.time, bb.calc.upper[i])));
    bb.mid.setData(bars.map((b, i) => point(b.time, bb.calc.mid[i])));
    bb.lower.setData(bars.map((b, i) => point(b.time, bb.calc.lower[i])));
  }
  if (set.rsi) {
    const r = set.rsi;
    r.calc.reset(bars);
    r.series.setData(bars.map((b, i) => point(b.time, r.calc.values[i])));
  }
  if (set.volume) set.volume.setData(bars.map((b) => ({ time: b.time as UTCTimestamp, value: b.volume || 0, color: withAlpha(b.close >= b.open ? pal.up : pal.down, 0.4) })));
}

function updateIndicators(set: IndicatorSet, bars: Candle[], i: number, pal: ChartPalette) {
  const b = bars[i];
  for (const m of set.ma) m.series.update(point(b.time, m.calc.at(bars, i)));
  if (set.bb) {
    set.bb.calc.at(bars, i);
    set.bb.upper.update(point(b.time, set.bb.calc.upper[i]));
    set.bb.mid.update(point(b.time, set.bb.calc.mid[i]));
    set.bb.lower.update(point(b.time, set.bb.calc.lower[i]));
  }
  if (set.rsi) set.rsi.series.update(point(b.time, set.rsi.calc.at(bars, i)));
  if (set.volume) set.volume.update({ time: b.time as UTCTimestamp, value: b.volume || 0, color: withAlpha(b.close >= b.open ? pal.up : pal.down, 0.4) });
}

function legendValues(set: IndicatorSet | null, i: number, digits: number): LegendValue[] {
  if (!set || i < 0) return [];
  const f = (v: number | undefined, d = digits) => (v !== undefined && Number.isFinite(v) ? v.toFixed(d) : '—');
  const out: LegendValue[] = set.ma.map((m) => ({ label: m.label, color: m.color, value: f(m.calc.values[i]) }));
  if (set.bb) out.push({ label: set.bb.label, color: set.bb.color, value: `${f(set.bb.calc.upper[i])}  ${f(set.bb.calc.lower[i])}` });
  if (set.rsi) out.push({ label: set.rsi.label, color: set.rsi.color, value: f(set.rsi.calc.values[i], 1) });
  return out;
}

/* ------------------------------------------------------------------ */

interface Props {
  digits: number;
  tz: string;
  /** Bar length in seconds, used to place drawings beyond the last candle. */
  tfSec: number;
  indicators?: IndicatorConfig;
  /** Shown at the top left: symbol, timeframe, data source. */
  title?: ReactNode;
  /** Shown under the title (for example quick Buy / Sell buttons). */
  legendExtra?: ReactNode;
  onPriceClick?(price: number): void;
  clickHint?: string | null;
  /** When set, hovering shows where a replay would start and clicking picks that candle. */
  onSelectBar?: ((time: number) => void) | null;
  /** Called whenever the underlying chart is (re)created, so the parent can push data. */
  onReady?(): void;
  /** Initial drawing-layer state; the parent updates it through api().layer.set(). */
  layerState: LayerState;
}

interface Legend {
  bar?: Candle;
  prevClose?: number;
  values: LegendValue[];
}

export const CandleChart = forwardRef<CandleChartHandle, Props>(function CandleChart(
  { digits, tz, tfSec, indicators = DEFAULT_INDICATORS, title, legendExtra, onPriceClick, clickHint, onSelectBar, onReady, layerState },
  ref,
) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const markers = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const layer = useRef<DrawingsLayer | null>(null);
  const lines = useRef<IPriceLine[]>([]);
  const bars = useRef<Candle[]>([]);
  const tfRef = useRef(tfSec);
  tfRef.current = tfSec;
  const ind = useRef<IndicatorSet | null>(null);
  const clickRef = useRef(onPriceClick);
  clickRef.current = onPriceClick;
  const selectRef = useRef(onSelectBar);
  selectRef.current = onSelectBar;
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  const layerInit = useRef(layerState);
  layerInit.current = layerState;
  const [legend, setLegend] = useState<Legend>({ values: [] });
  const [selectX, setSelectX] = useState<number | null>(null);
  const hovering = useRef(false);

  // ---- time <-> pixel mapping (also past the last candle) ----
  const logicalOf = (t: number): number => {
    const b = bars.current;
    const n = b.length;
    if (!n) return 0;
    const tf = tfRef.current;
    if (t <= b[0].time) return (t - b[0].time) / tf;
    if (t >= b[n - 1].time) return n - 1 + (t - b[n - 1].time) / tf;
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (b[mid].time <= t) lo = mid;
      else hi = mid;
    }
    return lo + (t - b[lo].time) / (b[hi].time - b[lo].time);
  };
  const timeOfLogical = (l: number): number => {
    const b = bars.current;
    const n = b.length;
    const tf = tfRef.current;
    if (!n) return 0;
    if (l <= 0) return b[0].time + l * tf;
    if (l >= n - 1) return b[n - 1].time + (l - (n - 1)) * tf;
    const i = Math.floor(l);
    return b[i].time + (l - i) * (b[i + 1].time - b[i].time);
  };
  const timeToX = (t: number): number | null => {
    const c = chart.current;
    if (!c || !bars.current.length) return null;
    return c.timeScale().logicalToCoordinate(logicalOf(t) as never);
  };
  const xToTime = (x: number): number | null => {
    const c = chart.current;
    if (!c || !bars.current.length) return null;
    const l = c.timeScale().coordinateToLogical(x);
    return l === null ? null : timeOfLogical(Math.round(l));
  };
  const barAt = (t: number): Candle | undefined => {
    const b = bars.current;
    if (!b.length) return undefined;
    const l = Math.round(logicalOf(t));
    return b[Math.max(0, Math.min(b.length - 1, l))];
  };
  const mapRef = useRef({ timeToX, xToTime, barAt });
  mapRef.current = { timeToX, xToTime, barAt };

  const refreshLegend = (i?: number) => {
    const b = bars.current;
    const idx = i ?? b.length - 1;
    if (idx < 0 || !b[idx]) {
      setLegend({ values: [] });
      return;
    }
    setLegend({ bar: b[idx], prevClose: idx > 0 ? b[idx - 1].close : undefined, values: legendValues(ind.current, idx, digits) });
  };
  const refreshLegendRef = useRef(refreshLegend);
  refreshLegendRef.current = refreshLegend;

  useEffect(() => {
    if (!box.current) return;
    const pal = chartPalette();
    const colours = chartColours(pal);
    const c = createChart(box.current, {
      autoSize: true,
      layout: {
        ...colours.layout,
        fontFamily: 'Archivo, ui-sans-serif, system-ui, sans-serif',
        fontSize: 12,
        attributionLogo: true,
      },
      grid: colours.grid,
      crosshair: { mode: CrosshairMode.Normal, ...colours.crosshair },
      rightPriceScale: { ...colours.rightPriceScale, scaleMargins: { top: 0.12, bottom: 0.08 } },
      timeScale: {
        ...colours.timeScale,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 12,
        tickMarkFormatter: (time: Time, type: TickMarkType) => {
          const p = zonedParts(time as number, tz);
          if (type === TickMarkType.Year) return String(p.year);
          if (type === TickMarkType.Month) return monthName(p.month);
          if (type === TickMarkType.DayOfMonth) return String(p.day);
          return `${pad(p.hour)}:${pad(p.minute)}`;
        },
      },
      localization: {
        timeFormatter: (time: Time) => formatDateTime(time as number, tz),
      },
    });
    const s = c.addSeries(CandlestickSeries, {
      ...candleColours(pal),
      borderVisible: false,
      priceFormat: { type: 'price', precision: digits, minMove: 10 ** -digits },
    });
    chart.current = c;
    series.current = s;
    markers.current = createSeriesMarkers(s, []);
    const lay = new DrawingsLayer((t) => mapRef.current.timeToX(t), layerInit.current);
    s.attachPrimitive(lay);
    layer.current = lay;
    ind.current = null;

    c.subscribeClick((param) => {
      if (selectRef.current) {
        if (param.time !== undefined) selectRef.current(param.time as number);
        return;
      }
      if (!param.point || !clickRef.current) return;
      const p = s.coordinateToPrice(param.point.y);
      if (p !== null) clickRef.current(Number(p.toFixed(digits)));
    });
    c.subscribeCrosshairMove((param) => {
      if (selectRef.current) {
        if (param.point && param.logical !== undefined) setSelectX(c.timeScale().logicalToCoordinate(Math.round(param.logical) as never));
        else setSelectX(null);
      }
      if (param.logical === undefined || !param.point) {
        if (hovering.current) {
          hovering.current = false;
          refreshLegendRef.current();
        }
        return;
      }
      hovering.current = true;
      const i = Math.round(param.logical);
      if (i >= 0 && i < bars.current.length) refreshLegendRef.current(i);
    });
    // Defer so the imperative handle is attached before the parent pushes data.
    const readyTimer = setTimeout(() => readyRef.current?.(), 0);
    return () => {
      clearTimeout(readyTimer);
      c.remove();
      chart.current = null;
      series.current = null;
      markers.current = null;
      layer.current = null;
      lines.current = [];
      ind.current = null;
    };
  }, [digits, tz]);

  // Indicators: rebuild when the settings change, keeping the candles.
  const indKey = JSON.stringify(indicators);
  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    removeIndicators(c, ind.current);
    const pal = chartPalette();
    ind.current = buildIndicators(c, indicators, pal, digits);
    fillIndicators(ind.current, bars.current, pal);
    refreshLegendRef.current();
  }, [indKey, digits, tz]); // eslint-disable-line react-hooks/exhaustive-deps

  // Day / night: recolour the existing chart in place, keeping data, zoom and price lines.
  const { theme } = useTheme();
  const firstTheme = useRef(true);
  useEffect(() => {
    if (firstTheme.current) {
      firstTheme.current = false;
      return;
    }
    const c = chart.current;
    if (!c) return;
    const pal = chartPalette();
    c.applyOptions(chartColours(pal));
    series.current?.applyOptions(candleColours(pal));
    removeIndicators(c, ind.current);
    ind.current = buildIndicators(c, indicators, pal, digits);
    fillIndicators(ind.current, bars.current, pal);
    refreshLegendRef.current();
  }, [theme]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!onSelectBar) setSelectX(null);
  }, [onSelectBar]);

  useImperativeHandle(
    ref,
    () => ({
      setBars(list, mode = 'follow') {
        const s = series.current;
        const c = chart.current;
        if (!s || !c) return;
        const range = c.timeScale().getVisibleLogicalRange();
        bars.current = list;
        s.setData(list.map(toBar));
        if (ind.current) fillIndicators(ind.current, list, chartPalette());
        const n = list.length;
        const width = mode === 'follow' && range ? Math.max(20, range.to - range.from) : 150;
        c.timeScale().setVisibleLogicalRange({ from: n - width + 12, to: n + 12 });
        if (!hovering.current) refreshLegendRef.current();
      },
      updateBar(bar) {
        const s = series.current;
        if (!s) return;
        const b = bars.current;
        const last = b[b.length - 1];
        if (last && last.time === bar.time) b[b.length - 1] = bar;
        else if (!last || bar.time > last.time) b.push(bar);
        else return;
        s.update(toBar(bar));
        if (ind.current) updateIndicators(ind.current, b, b.length - 1, chartPalette());
        if (!hovering.current) refreshLegendRef.current();
      },
      setMarkers(list) {
        markers.current?.setMarkers(
          [...list]
            .sort((a, b) => a.time - b.time)
            .map((m) => ({ time: m.time as UTCTimestamp, position: m.position, shape: m.shape, color: m.color, text: m.text }) as SeriesMarker<Time>),
        );
      },
      setLines(specs) {
        const s = series.current;
        if (!s) return;
        for (const l of lines.current) s.removePriceLine(l);
        lines.current = specs.map((sp) =>
          s.createPriceLine({
            price: sp.price,
            color: sp.color,
            lineWidth: sp.width ?? 1,
            lineStyle: sp.style === 'solid' ? LineStyle.Solid : sp.style === 'dotted' ? LineStyle.Dotted : LineStyle.Dashed,
            axisLabelVisible: true,
            title: sp.title,
          }),
        );
      },
      showLatest(n = 140) {
        const c = chart.current;
        if (!c) return;
        const len = bars.current.length;
        c.timeScale().setVisibleLogicalRange({ from: Math.max(-5, len - n), to: len + 12 });
      },
      api() {
        const c = chart.current;
        const s = series.current;
        const l = layer.current;
        if (!c || !s || !l || !box.current) return null;
        return {
          chart: c,
          series: s,
          box: box.current,
          layer: l,
          bars: () => bars.current,
          tfSec: () => tfRef.current,
          timeToX: (t) => mapRef.current.timeToX(t),
          xToTime: (x) => mapRef.current.xToTime(x),
          barAt: (t) => mapRef.current.barAt(t),
        };
      },
    }),
    [],
  );

  const bar = legend.bar;
  const up = bar ? bar.close >= bar.open : true;
  const chg = bar && legend.prevClose !== undefined ? bar.close - legend.prevClose : undefined;
  const valueClass = up ? 'text-profit-fg' : 'text-loss-fg';
  const paneW = chart.current?.paneSize(0).width ?? 0;

  return (
    <div className="relative h-full w-full">
      <div ref={box} className="absolute inset-0" style={{ cursor: clickHint || onSelectBar ? 'crosshair' : undefined }} />
      <div className="pointer-events-none absolute left-3 top-2 z-[3] max-w-[calc(100%-90px)] space-y-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[13px]">
          {title}
          {bar && (
            <span className="type-data flex flex-wrap gap-x-2 text-[12px]">
              <span className="text-fg-3">
                O <span className={valueClass}>{bar.open.toFixed(digits)}</span>
              </span>
              <span className="text-fg-3">
                H <span className={valueClass}>{bar.high.toFixed(digits)}</span>
              </span>
              <span className="text-fg-3">
                L <span className={valueClass}>{bar.low.toFixed(digits)}</span>
              </span>
              <span className="text-fg-3">
                C <span className={valueClass}>{bar.close.toFixed(digits)}</span>
              </span>
              {chg !== undefined && legend.prevClose ? (
                <span className={chg >= 0 ? 'text-profit-fg' : 'text-loss-fg'}>
                  {chg >= 0 ? '+' : '−'}
                  {Math.abs(chg).toFixed(digits)} ({chg >= 0 ? '+' : '−'}
                  {Math.abs((chg / legend.prevClose) * 100).toFixed(2)}%)
                </span>
              ) : null}
            </span>
          )}
        </div>
        {legendExtra && <div className="pointer-events-auto">{legendExtra}</div>}
        {legend.values.length > 0 && (
          <div className="type-data flex flex-col gap-0.5 text-[12px]">
            {legend.values.map((v) => (
              <span key={v.label}>
                <span className="text-fg-2">{v.label}</span> <span style={{ color: v.color }}>{v.value}</span>
              </span>
            ))}
          </div>
        )}
      </div>
      {onSelectBar && selectX !== null && (
        <div className="pointer-events-none absolute inset-y-0 z-[2]" style={{ left: selectX, width: Math.max(0, paneW - selectX) }}>
          <div className="absolute inset-0 bg-ink-950/60" />
          <div className="absolute inset-y-0 left-0 w-[2px] -translate-x-1/2 bg-brass" />
        </div>
      )}
      {clickHint && (
        <div className="pointer-events-none absolute left-1/2 top-14 z-[4] max-w-[90%] -translate-x-1/2 rounded-full border border-brass/60 bg-ink-900/95 px-3 py-1 text-center text-[13px] text-fg shadow-sm">{clickHint}</div>
      )}
    </div>
  );
});
