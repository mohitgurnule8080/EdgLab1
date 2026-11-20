import type { IChartApi, ISeriesApi, ISeriesPrimitive, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitiveAxisView, SeriesAttachedParameter, Time } from 'lightweight-charts';
import { uid } from '../lib/format';

/**
 * Chart drawings: trend lines, rays, horizontal and vertical lines, rectangles, Fibonacci
 * retracements, long / short position tools, a measure tool and text notes.
 *
 * Points are stored as (time, price), so a drawing stays on the same candles when the
 * timeframe changes. They are painted by a series primitive, inside the chart's own redraw,
 * so they never lag behind scrolling, zooming or price-scale changes.
 */

export type DrawKind = 'trend' | 'ray' | 'hline' | 'vline' | 'rect' | 'fib' | 'long' | 'short' | 'measure' | 'text';
export type ToolId = 'cursor' | DrawKind;

export interface Pt {
  t: number;
  p: number;
}

export interface Drawing {
  id: string;
  kind: DrawKind;
  a: Pt;
  /** Second point (trend, ray, rect, fib, measure); for long / short only b.t (right edge) is used. */
  b?: Pt;
  stop?: number;
  target?: number;
  text?: string;
}

export const TWO_POINT: DrawKind[] = ['trend', 'ray', 'rect', 'fib', 'measure'];
export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

/** Pixel mapping of the chart pane at this moment. Null when a point is off the data. */
export interface PaneMap {
  width: number;
  height: number;
  x(t: number): number | null;
  y(p: number): number | null;
}

export interface Handle {
  id: 'a' | 'b' | 'ab' | 'ba' | 'stop' | 'target' | 'right';
  x: number;
  y: number;
}

export interface DrawingStyle {
  line: string;
  up: string;
  down: string;
  text: string;
  labelBg: string;
  surface: string;
  measure: string;
}

export interface Formatters {
  price(p: number): string;
  /** Distance in pips, e.g. "20.0 pips". */
  pips(d: number): string;
  /** Money at risk for the position tool's stop, used to show the amounts. */
  riskMoney: number | null;
  money(v: number): string;
  duration(sec: number): string;
  bars(t1: number, t2: number): number;
}

// ---------------------------------------------------------------------------
// Geometry and hit testing (shared by the painter and the mouse handling)

const dist2 = (ax: number, ay: number, bx: number, by: number) => (ax - bx) ** 2 + (ay - by) ** 2;

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const l2 = dist2(ax, ay, bx, by);
  if (l2 === 0) return Math.sqrt(dist2(px, py, ax, ay));
  const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / l2));
  return Math.sqrt(dist2(px, py, ax + t * (bx - ax), ay + t * (by - ay)));
}

/** End of a ray from a through b, clipped to the pane. */
function rayEnd(ax: number, ay: number, bx: number, by: number, w: number, h: number): [number, number] {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return [bx, by];
  let t = Infinity;
  if (dx > 0) t = Math.min(t, (w - ax) / dx);
  if (dx < 0) t = Math.min(t, -ax / dx);
  if (dy > 0) t = Math.min(t, (h - ay) / dy);
  if (dy < 0) t = Math.min(t, -ay / dy);
  if (!Number.isFinite(t) || t < 1) t = 1;
  return [ax + dx * t, ay + dy * t];
}

export function fibPrice(d: Drawing, level: number): number {
  const b = d.b ?? d.a;
  return b.p + (d.a.p - b.p) * level;
}

/** Handles of a drawing in pixels (only for points that are on screen). */
export function handlesOf(d: Drawing, m: PaneMap): Handle[] {
  const ax = m.x(d.a.t);
  const ay = m.y(d.a.p);
  const out: Handle[] = [];
  if (d.kind === 'hline') {
    if (ay !== null) out.push({ id: 'a', x: ax ?? m.width / 2, y: ay });
    return out;
  }
  if (d.kind === 'vline') {
    if (ax !== null) out.push({ id: 'a', x: ax, y: ay ?? m.height / 2 });
    return out;
  }
  if (ax === null || ay === null) return out;
  if (d.kind === 'text') return [{ id: 'a', x: ax, y: ay }];
  if (d.kind === 'long' || d.kind === 'short') {
    const bx = d.b ? m.x(d.b.t) : null;
    const sy = d.stop !== undefined ? m.y(d.stop) : null;
    const ty = d.target !== undefined ? m.y(d.target) : null;
    out.push({ id: 'a', x: ax, y: ay });
    if (ty !== null) out.push({ id: 'target', x: ax, y: ty });
    if (sy !== null) out.push({ id: 'stop', x: ax, y: sy });
    if (bx !== null) out.push({ id: 'right', x: bx, y: ay });
    return out;
  }
  if (!d.b) return [{ id: 'a', x: ax, y: ay }];
  const bx = m.x(d.b.t);
  const by = m.y(d.b.p);
  if (bx === null || by === null) return [{ id: 'a', x: ax, y: ay }];
  out.push({ id: 'a', x: ax, y: ay }, { id: 'b', x: bx, y: by });
  if (d.kind === 'rect') out.push({ id: 'ab', x: ax, y: by }, { id: 'ba', x: bx, y: ay });
  return out;
}

/** Distance in pixels from a point to the drawing's lines or body (Infinity when far or off screen). */
export function hitDistance(d: Drawing, m: PaneMap, px: number, py: number): number {
  const ax = m.x(d.a.t);
  const ay = m.y(d.a.p);
  switch (d.kind) {
    case 'hline':
      return ay === null ? Infinity : Math.abs(py - ay);
    case 'vline':
      return ax === null ? Infinity : Math.abs(px - ax);
    case 'text': {
      if (ax === null || ay === null) return Infinity;
      const w = Math.max(30, (d.text?.length ?? 4) * 7 + 16);
      return px >= ax - 4 && px <= ax + w && py >= ay - 26 && py <= ay + 4 ? 0 : Infinity;
    }
    case 'long':
    case 'short': {
      const bx = d.b ? m.x(d.b.t) : null;
      const sy = d.stop !== undefined ? m.y(d.stop) : null;
      const ty = d.target !== undefined ? m.y(d.target) : null;
      if (ax === null || ay === null || bx === null || sy === null || ty === null) return Infinity;
      const x1 = Math.min(ax, bx);
      const x2 = Math.max(ax, bx);
      const y1 = Math.min(sy, ty);
      const y2 = Math.max(sy, ty);
      return px >= x1 && px <= x2 && py >= y1 && py <= y2 ? 0 : Infinity;
    }
  }
  if (!d.b || ax === null || ay === null) return Infinity;
  const bx = m.x(d.b.t);
  const by = m.y(d.b.p);
  if (bx === null || by === null) return Infinity;
  if (d.kind === 'trend') return distToSegment(px, py, ax, ay, bx, by);
  if (d.kind === 'ray') {
    const [ex, ey] = rayEnd(ax, ay, bx, by, m.width, m.height);
    return distToSegment(px, py, ax, ay, ex, ey);
  }
  const x1 = Math.min(ax, bx);
  const x2 = Math.max(ax, bx);
  if (d.kind === 'fib') {
    if (px < x1 - 6 || px > x2 + 6) return Infinity;
    let best = Infinity;
    for (const l of FIB_LEVELS) {
      const y = m.y(fibPrice(d, l));
      if (y !== null) best = Math.min(best, Math.abs(py - y));
    }
    return best;
  }
  // rect and measure: the edges, or anywhere inside
  const y1 = Math.min(ay, by);
  const y2 = Math.max(ay, by);
  if (px >= x1 && px <= x2 && py >= y1 && py <= y2) return 0;
  return Math.min(distToSegment(px, py, x1, y1, x2, y1), distToSegment(px, py, x1, y2, x2, y2), distToSegment(px, py, x1, y1, x1, y2), distToSegment(px, py, x2, y1, x2, y2));
}

/** Topmost drawing within `tolerance` pixels of the point. */
export function hitTest(list: Drawing[], m: PaneMap, px: number, py: number, tolerance = 6): Drawing | null {
  let best: Drawing | null = null;
  let bestD = tolerance;
  for (let i = list.length - 1; i >= 0; i--) {
    const d = hitDistance(list[i], m, px, py);
    if (d <= bestD) {
      best = list[i];
      bestD = d;
      if (d === 0) break;
    }
  }
  return best;
}

export function hitHandle(d: Drawing, m: PaneMap, px: number, py: number, radius = 8): Handle | null {
  for (const h of handlesOf(d, m)) if (dist2(px, py, h.x, h.y) <= radius * radius) return h;
  return null;
}

// ---------------------------------------------------------------------------
// Creating and editing

/** Default size of a new long / short position: 1.5 x ATR stop, 2R target, 20 bars wide. */
export function newPosition(kind: 'long' | 'short', at: Pt, atr: number, tfSec: number): Drawing {
  const risk = atr > 0 ? atr * 1.5 : Math.abs(at.p) * 0.002;
  const dir = kind === 'long' ? 1 : -1;
  return { id: uid('d'), kind, a: at, b: { t: at.t + 20 * tfSec, p: at.p }, stop: at.p - dir * risk, target: at.p + dir * risk * 2 };
}

export function createDrawing(kind: DrawKind, a: Pt, b?: Pt): Drawing {
  return { id: uid('d'), kind, a, b: b ?? (TWO_POINT.includes(kind) ? { ...a } : undefined) };
}

/** Apply a drag of handle `h` (or of the whole drawing when h is null) by the move from `from` to `to`. */
export function dragDrawing(d: Drawing, h: Handle['id'] | null, from: Pt, to: Pt): Drawing {
  const dt = to.t - from.t;
  const dp = to.p - from.p;
  if (h === null) {
    return {
      ...d,
      a: { t: d.a.t + dt, p: d.a.p + dp },
      b: d.b ? { t: d.b.t + dt, p: d.b.p + dp } : undefined,
      stop: d.stop !== undefined ? d.stop + dp : undefined,
      target: d.target !== undefined ? d.target + dp : undefined,
    };
  }
  const long = d.kind === 'long';
  const short = d.kind === 'short';
  switch (h) {
    case 'a':
      if (long || short) {
        // Moving the entry keeps the stop and target where they are, but never past them.
        const lo = long ? (d.stop ?? -Infinity) : (d.target ?? -Infinity);
        const hi = long ? (d.target ?? Infinity) : (d.stop ?? Infinity);
        const width = d.b ? d.b.t - d.a.t : 0;
        const p = Math.min(hi - 1e-12, Math.max(lo + 1e-12, to.p));
        return { ...d, a: { t: to.t, p }, b: d.b ? { t: to.t + width, p } : undefined };
      }
      return { ...d, a: { ...to } };
    case 'b':
      return { ...d, b: { ...to } };
    case 'ab':
      return { ...d, a: { t: to.t, p: d.a.p }, b: d.b ? { t: d.b.t, p: to.p } : undefined };
    case 'ba':
      return { ...d, a: { t: d.a.t, p: to.p }, b: d.b ? { t: to.t, p: d.b.p } : undefined };
    case 'stop':
      return { ...d, stop: long ? Math.min(d.a.p - 1e-12, to.p) : Math.max(d.a.p + 1e-12, to.p) };
    case 'target':
      return { ...d, target: long ? Math.max(d.a.p + 1e-12, to.p) : Math.min(d.a.p - 1e-12, to.p) };
    case 'right':
      return { ...d, b: { t: Math.max(d.a.t + 1, to.t), p: d.a.p } };
  }
}

/** Risk / reward numbers of a position tool. */
export function positionStats(d: Drawing) {
  const risk = Math.abs(d.a.p - (d.stop ?? d.a.p));
  const reward = Math.abs((d.target ?? d.a.p) - d.a.p);
  return { risk, reward, rr: risk > 0 ? reward / risk : 0 };
}

// ---------------------------------------------------------------------------
// Painting

type Ctx = CanvasRenderingContext2D;
interface DrawTarget {
  useMediaCoordinateSpace<T>(f: (scope: { context: Ctx; mediaSize: { width: number; height: number } }) => T): T;
}

export interface LayerState {
  drawings: Drawing[];
  selected: string | null;
  draft: Drawing | null;
  hidden: boolean;
  /** True when the cursor tool is active, so hovering a drawing shows it can be grabbed. */
  interactive?: boolean;
  style: DrawingStyle;
  fmt: Formatters;
}

const FONT = '12px Archivo, ui-sans-serif, system-ui, sans-serif';
const FONT_BOLD = '600 12px Archivo, ui-sans-serif, system-ui, sans-serif';

function alpha(color: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (m) {
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }
  const r = /^rgba?\(([^)]+)\)$/.exec(color.trim());
  if (r) {
    const [x, y, z] = r[1].split(',').map((v) => v.trim());
    return `rgba(${x}, ${y}, ${z}, ${a})`;
  }
  return color;
}

function label(ctx: Ctx, text: string, x: number, y: number, s: DrawingStyle, opts: { align?: 'left' | 'center' | 'right'; bg?: string; fg?: string; bold?: boolean } = {}) {
  ctx.font = opts.bold ? FONT_BOLD : FONT;
  const w = ctx.measureText(text).width + 12;
  const h = 20;
  const left = opts.align === 'center' ? x - w / 2 : opts.align === 'right' ? x - w : x;
  ctx.fillStyle = opts.bg ?? s.labelBg;
  ctx.beginPath();
  ctx.roundRect(left, y - h / 2, w, h, 4);
  ctx.fill();
  ctx.fillStyle = opts.fg ?? s.text;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(text, left + 6, y + 0.5);
}

function paintDrawing(ctx: Ctx, d: Drawing, m: PaneMap, st: LayerState, selected: boolean) {
  const s = st.style;
  const f = st.fmt;
  const ax = m.x(d.a.t);
  const ay = m.y(d.a.p);
  ctx.lineWidth = selected ? 2 : 1.5;
  ctx.strokeStyle = s.line;
  ctx.setLineDash([]);

  switch (d.kind) {
    case 'hline': {
      if (ay === null) return;
      ctx.beginPath();
      ctx.moveTo(0, ay);
      ctx.lineTo(m.width, ay);
      ctx.stroke();
      return;
    }
    case 'vline': {
      if (ax === null) return;
      ctx.beginPath();
      ctx.moveTo(ax, 0);
      ctx.lineTo(ax, m.height);
      ctx.stroke();
      return;
    }
    case 'text': {
      if (ax === null || ay === null) return;
      label(ctx, d.text || 'Note', ax, ay - 11, s, { bg: alpha(s.line, 0.9), fg: s.surface, bold: true });
      return;
    }
    case 'long':
    case 'short': {
      const bx = d.b ? m.x(d.b.t) : null;
      const sy = d.stop !== undefined ? m.y(d.stop) : null;
      const ty = d.target !== undefined ? m.y(d.target) : null;
      if (ax === null || ay === null || bx === null || sy === null || ty === null) return;
      const x1 = Math.min(ax, bx);
      const w = Math.abs(bx - ax);
      ctx.fillStyle = alpha(s.up, 0.16);
      ctx.fillRect(x1, Math.min(ay, ty), w, Math.abs(ty - ay));
      ctx.fillStyle = alpha(s.down, 0.16);
      ctx.fillRect(x1, Math.min(ay, sy), w, Math.abs(sy - ay));
      ctx.lineWidth = 1;
      ctx.strokeStyle = alpha(s.up, 0.9);
      ctx.beginPath();
      ctx.moveTo(x1, ty);
      ctx.lineTo(x1 + w, ty);
      ctx.stroke();
      ctx.strokeStyle = alpha(s.down, 0.9);
      ctx.beginPath();
      ctx.moveTo(x1, sy);
      ctx.lineTo(x1 + w, sy);
      ctx.stroke();
      ctx.strokeStyle = s.text;
      ctx.beginPath();
      ctx.moveTo(x1, ay);
      ctx.lineTo(x1 + w, ay);
      ctx.stroke();
      const ps = positionStats(d);
      const cx = x1 + w / 2;
      const money = (r: number) => (f.riskMoney !== null ? `, ${f.money(f.riskMoney * r)}` : '');
      if (selected || w > 150) {
        label(ctx, `Target ${f.pips(ps.reward)}${money(ps.rr)}`, cx, ty + (ty < ay ? -12 : 12), s, { align: 'center', bg: s.up, fg: s.surface });
        label(ctx, `Stop ${f.pips(ps.risk)}${f.riskMoney !== null ? `, ${f.money(-f.riskMoney)}` : ''}`, cx, sy + (sy > ay ? 12 : -12), s, { align: 'center', bg: s.down, fg: s.surface });
      }
      label(ctx, `${d.kind === 'long' ? 'Long' : 'Short'}  R:R ${ps.rr.toFixed(2)}`, cx, ay, s, { align: 'center', bold: true });
      return;
    }
  }

  if (!d.b || ax === null || ay === null) return;
  const bx = m.x(d.b.t);
  const by = m.y(d.b.p);
  if (bx === null || by === null) return;

  if (d.kind === 'trend') {
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    return;
  }
  if (d.kind === 'ray') {
    const [ex, ey] = rayEnd(ax, ay, bx, by, m.width, m.height);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    return;
  }
  const x1 = Math.min(ax, bx);
  const x2 = Math.max(ax, bx);
  if (d.kind === 'rect') {
    ctx.fillStyle = alpha(s.line, 0.12);
    ctx.fillRect(x1, Math.min(ay, by), x2 - x1, Math.abs(by - ay));
    ctx.strokeRect(x1, Math.min(ay, by), x2 - x1, Math.abs(by - ay));
    return;
  }
  if (d.kind === 'fib') {
    // Trend line between the two points, then the levels.
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = alpha(s.line, 0.6);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.setLineDash([]);
    let prevY: number | null = null;
    FIB_LEVELS.forEach((l, i) => {
      const y = m.y(fibPrice(d, l));
      if (y === null) return;
      if (prevY !== null && i % 2 === 1) {
        ctx.fillStyle = alpha(s.line, 0.07);
        ctx.fillRect(x1, Math.min(prevY, y), x2 - x1, Math.abs(y - prevY));
      }
      prevY = y;
      ctx.strokeStyle = l === 0.5 || l === 0.618 ? s.line : alpha(s.line, 0.65);
      ctx.lineWidth = l === 0.618 ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(x1, y);
      ctx.lineTo(x2, y);
      ctx.stroke();
      ctx.font = FONT;
      ctx.fillStyle = s.text;
      ctx.textBaseline = 'bottom';
      ctx.textAlign = 'left';
      ctx.fillText(`${l} (${f.price(fibPrice(d, l))})`, x1 + 4, y - 2);
    });
    return;
  }
  if (d.kind === 'measure') {
    const up = d.b.p >= d.a.p;
    const col = up ? s.up : s.down;
    ctx.fillStyle = alpha(col, 0.16);
    ctx.fillRect(x1, Math.min(ay, by), x2 - x1, Math.abs(by - ay));
    ctx.strokeStyle = col;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo((ax + bx) / 2, ay);
    ctx.lineTo((ax + bx) / 2, by);
    ctx.moveTo(ax, (ay + by) / 2);
    ctx.lineTo(bx, (ay + by) / 2);
    ctx.stroke();
    const dp = d.b.p - d.a.p;
    const pctv = d.a.p ? (dp / d.a.p) * 100 : 0;
    const bars = f.bars(d.a.t, d.b.t);
    const line1 = `${dp >= 0 ? '+' : '−'}${f.price(Math.abs(dp))} (${pctv >= 0 ? '+' : '−'}${Math.abs(pctv).toFixed(2)}%) ${f.pips(Math.abs(dp))}`;
    const line2 = `${bars} bars, ${f.duration(Math.abs(d.b.t - d.a.t))}`;
    const ly = up ? Math.min(ay, by) - 30 : Math.max(ay, by) + 12;
    label(ctx, line1, (ax + bx) / 2, ly, s, { align: 'center', bg: col, fg: s.surface, bold: true });
    label(ctx, line2, (ax + bx) / 2, ly + 20, s, { align: 'center', bg: col, fg: s.surface });
  }
}

function paintHandles(ctx: Ctx, d: Drawing, m: PaneMap, s: DrawingStyle) {
  ctx.setLineDash([]);
  for (const h of handlesOf(d, m)) {
    ctx.beginPath();
    ctx.arc(h.x, h.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = s.surface;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = h.id === 'stop' ? s.down : h.id === 'target' ? s.up : s.line;
    ctx.stroke();
  }
}

class LayerRenderer implements IPrimitivePaneRenderer {
  constructor(private layer: DrawingsLayer) {}
  draw(target: unknown) {
    const t = target as DrawTarget;
    const layer = this.layer;
    const st = layer.state;
    const map = layer.paneMap();
    if (!map || st.hidden) {
      if (!map || !st.draft) return;
    }
    t.useMediaCoordinateSpace(({ context: ctx }) => {
      ctx.save();
      if (!st.hidden) {
        for (const d of st.drawings) paintDrawing(ctx, d, map!, st, d.id === st.selected);
        const sel = st.drawings.find((d) => d.id === st.selected);
        if (sel) paintHandles(ctx, sel, map!, st.style);
      }
      if (st.draft) {
        paintDrawing(ctx, st.draft, map!, st, true);
        paintHandles(ctx, st.draft, map!, st.style);
      }
      ctx.restore();
    });
  }
}

class LayerPaneView implements IPrimitivePaneView {
  private r: LayerRenderer;
  constructor(layer: DrawingsLayer) {
    this.r = new LayerRenderer(layer);
  }
  zOrder() {
    return 'top' as const;
  }
  renderer() {
    return this.r;
  }
}

class HLineAxisView implements ISeriesPrimitiveAxisView {
  constructor(
    private layer: DrawingsLayer,
    private price: number,
  ) {}
  coordinate() {
    return this.layer.series?.priceToCoordinate(this.price) ?? -100;
  }
  text() {
    return this.layer.state.fmt.price(this.price);
  }
  textColor() {
    return this.layer.state.style.surface;
  }
  backColor() {
    return this.layer.state.style.line;
  }
  visible() {
    return !this.layer.state.hidden;
  }
}

/** Series primitive that paints all drawings. Owned by the chart; state is pushed in with `set`. */
export class DrawingsLayer implements ISeriesPrimitive<Time> {
  chart: IChartApi | null = null;
  series: ISeriesApi<'Candlestick'> | null = null;
  state: LayerState;
  private view = new LayerPaneView(this);
  private request: (() => void) | null = null;
  private axisViews: HLineAxisView[] = [];

  constructor(
    private timeToX: (t: number) => number | null,
    initial: LayerState,
  ) {
    this.state = initial;
  }

  attached(param: SeriesAttachedParameter<Time>) {
    this.chart = param.chart as IChartApi;
    this.series = param.series as ISeriesApi<'Candlestick'>;
    this.request = param.requestUpdate;
  }

  detached() {
    this.chart = null;
    this.series = null;
    this.request = null;
  }

  set(next: Partial<LayerState>) {
    this.state = { ...this.state, ...next };
    this.axisViews = this.state.drawings.filter((d) => d.kind === 'hline').map((d) => new HLineAxisView(this, d.a.p));
    this.request?.();
  }

  paneMap(): PaneMap | null {
    const c = this.chart;
    const s = this.series;
    if (!c || !s) return null;
    const size = c.paneSize(0);
    return { width: size.width, height: size.height, x: this.timeToX, y: (p) => s.priceToCoordinate(p) };
  }

  updateAllViews() {}

  paneViews() {
    return [this.view];
  }

  priceAxisViews() {
    return this.axisViews;
  }

  hitTest(x: number, y: number) {
    const st = this.state;
    if (st.hidden || st.interactive === false) return null;
    const m = this.paneMap();
    if (!m) return null;
    const sel = st.drawings.find((d) => d.id === st.selected);
    if (sel && hitHandle(sel, m, x, y)) return { cursorStyle: 'move', externalId: sel.id, zOrder: 'top' as const };
    const d = hitTest(st.drawings, m, x, y);
    return d ? { cursorStyle: 'pointer', externalId: d.id, zOrder: 'top' as const } : null;
  }
}
