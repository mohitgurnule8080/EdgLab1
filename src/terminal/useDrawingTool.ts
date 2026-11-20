import { useEffect, useRef } from 'react';
import type { ChartApi } from '../components/CandleChart';
import { atr } from '../core/indicators';
import { TWO_POINT, createDrawing, dragDrawing, hitHandle, hitTest, newPosition, type Drawing, type DrawingStyle, type Formatters, type Handle, type PaneMap, type Pt, type ToolId } from './drawings';

interface Options {
  api: () => ChartApi | null;
  /** Changes whenever the chart is created again (new series, new layer). */
  apiVersion: number;
  tool: ToolId;
  setTool(t: ToolId): void;
  drawings: Drawing[];
  onChange(next: Drawing[]): void;
  selected: string | null;
  setSelected(id: string | null): void;
  magnet: boolean;
  hidden: boolean;
  /** Keep the tool after drawing instead of going back to the cursor. */
  stayInMode: boolean;
  style: DrawingStyle;
  fmt: Formatters;
  onTextNeeded(d: Drawing): void;
}

type Gesture =
  | { type: 'drag'; id: string; handle: Handle['id'] | null; start: Pt; orig: Drawing; downX: number; downY: number; moved: boolean }
  | { type: 'place'; draft: Drawing; downX: number; downY: number; mouseDown: boolean };

function paneMap(api: ChartApi): PaneMap {
  const size = api.chart.paneSize(0);
  return { width: size.width, height: size.height, x: (t) => api.timeToX(t), y: (p) => api.series.priceToCoordinate(p) };
}

/**
 * Mouse and touch handling for the drawing tools. Drawings being placed or dragged are pushed
 * straight to the chart layer (no React render per mouse move); the result is committed with
 * onChange when the gesture ends.
 */
export function useDrawingTool(o: Options) {
  const opts = useRef(o);
  opts.current = o;
  const gesture = useRef<Gesture | null>(null);
  const live = useRef<Drawing[] | null>(null);

  // Push state to the chart layer.
  useEffect(() => {
    const api = o.api();
    if (!api) return;
    api.layer.set({
      drawings: live.current ?? o.drawings,
      selected: o.selected,
      hidden: o.hidden,
      style: o.style,
      fmt: o.fmt,
      interactive: o.tool === 'cursor',
      draft: gesture.current?.type === 'place' ? gesture.current.draft : null,
    });
  }, [o.apiVersion, o.drawings, o.selected, o.hidden, o.style, o.fmt, o.tool]); // eslint-disable-line react-hooks/exhaustive-deps

  // A tool change cancels whatever was being placed.
  useEffect(() => {
    if (gesture.current?.type === 'place') {
      gesture.current = null;
      opts.current.api()?.layer.set({ draft: null });
      setScroll(true);
    }
  }, [o.tool]); // eslint-disable-line react-hooks/exhaustive-deps

  function setScroll(on: boolean) {
    const api = opts.current.api();
    api?.chart.applyOptions({ handleScroll: on, handleScale: on });
  }

  useEffect(() => {
    const api = o.api();
    if (!api) return;
    const box = api.box;

    const toPt = (clientX: number, clientY: number): { pt: Pt; x: number; y: number } | null => {
      const a = opts.current.api();
      if (!a) return null;
      const r = box.getBoundingClientRect();
      const x = clientX - r.left;
      const y = clientY - r.top;
      const size = a.chart.paneSize(0);
      if (x < 0 || y < 0 || x > size.width || y > size.height) return null;
      const t = a.xToTime(x);
      let p: number | null = a.series.coordinateToPrice(y);
      if (t === null || p === null) return null;
      if (opts.current.magnet) {
        const bar = a.barAt(t);
        if (bar) {
          let best = p;
          let bestD = Infinity;
          for (const v of [bar.open, bar.high, bar.low, bar.close]) {
            const vy = a.series.priceToCoordinate(v);
            if (vy !== null && Math.abs(vy - y) < bestD) {
              bestD = Math.abs(vy - y);
              best = v;
            }
          }
          p = best;
        }
      }
      return { pt: { t, p }, x, y };
    };

    const pushLive = (list: Drawing[], draft: Drawing | null = null) => {
      opts.current.api()?.layer.set({ drawings: list, draft });
    };

    const commit = (list: Drawing[], select: string | null) => {
      live.current = null;
      opts.current.onChange(list);
      opts.current.setSelected(select);
    };

    const finishPlacing = (draft: Drawing) => {
      gesture.current = null;
      setScroll(true);
      opts.current.api()?.layer.set({ draft: null });
      const o2 = opts.current;
      commit([...o2.drawings, draft], draft.id);
      if (!o2.stayInMode) o2.setTool('cursor');
    };

    const down = (clientX: number, clientY: number, ev: Event): boolean => {
      const o2 = opts.current;
      const a = o2.api();
      if (!a) return false;
      const hit = toPt(clientX, clientY);
      if (!hit) return false;
      const g = gesture.current;

      // Second click of a two-point drawing.
      if (g?.type === 'place') {
        ev.preventDefault();
        ev.stopPropagation();
        finishPlacing({ ...g.draft, b: hit.pt });
        return true;
      }

      if (o2.tool !== 'cursor') {
        ev.preventDefault();
        ev.stopPropagation();
        const kind = o2.tool;
        if (TWO_POINT.includes(kind)) {
          const draft = createDrawing(kind, hit.pt, hit.pt);
          gesture.current = { type: 'place', draft, downX: hit.x, downY: hit.y, mouseDown: true };
          setScroll(false);
          pushLive(o2.drawings, draft);
          return true;
        }
        let d: Drawing;
        if (kind === 'long' || kind === 'short') d = newPosition(kind, hit.pt, atr(a.bars()), a.tfSec());
        else d = createDrawing(kind, hit.pt);
        commit([...o2.drawings, d], d.id);
        if (!o2.stayInMode) o2.setTool('cursor');
        if (kind === 'text') o2.onTextNeeded(d);
        return true;
      }

      // Cursor: grab a handle of the selected drawing, or any drawing.
      if (o2.hidden) return false;
      const m = paneMap(a);
      const sel = o2.drawings.find((d) => d.id === o2.selected);
      const handle = sel ? hitHandle(sel, m, hit.x, hit.y) : null;
      const target = handle ? sel! : hitTest(o2.drawings, m, hit.x, hit.y);
      // Measurements are temporary: they go away on the next click elsewhere.
      const measures = o2.drawings.filter((d) => d.kind === 'measure' && d.id !== target?.id);
      if (!target) {
        if (measures.length) commit(o2.drawings.filter((d) => d.kind !== 'measure'), null);
        else if (o2.selected) o2.setSelected(null);
        return false;
      }
      ev.preventDefault();
      ev.stopPropagation();
      const base = measures.length ? o2.drawings.filter((d) => !measures.includes(d)) : o2.drawings;
      if (measures.length) commit(base, target.id);
      else if (o2.selected !== target.id) o2.setSelected(target.id);
      gesture.current = { type: 'drag', id: target.id, handle: handle?.id ?? null, start: hit.pt, orig: target, downX: hit.x, downY: hit.y, moved: false };
      setScroll(false);
      return true;
    };

    const move = (clientX: number, clientY: number) => {
      const g = gesture.current;
      if (!g) return;
      const hit = toPt(clientX, clientY);
      if (!hit) return;
      const o2 = opts.current;
      if (g.type === 'place') {
        g.draft = { ...g.draft, b: hit.pt };
        pushLive(o2.drawings, g.draft);
        return;
      }
      if (!g.moved && Math.hypot(hit.x - g.downX, hit.y - g.downY) < 3) return;
      g.moved = true;
      const next = dragDrawing(g.orig, g.handle, g.start, hit.pt);
      const list = (live.current ?? o2.drawings).map((d) => (d.id === g.id ? next : d));
      live.current = list;
      pushLive(list);
    };

    const up = (clientX: number, clientY: number) => {
      const g = gesture.current;
      if (!g) return;
      if (g.type === 'place') {
        if (!g.mouseDown) return;
        g.mouseDown = false;
        // Dragged out the second point: finish now. A plain click waits for the second click.
        const hit = toPt(clientX, clientY);
        if (hit && Math.hypot(hit.x - g.downX, hit.y - g.downY) > 6) finishPlacing({ ...g.draft, b: hit.pt });
        return;
      }
      gesture.current = null;
      setScroll(true);
      if (g.moved && live.current) commit(live.current, g.id);
      live.current = null;
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      down(e.clientX, e.clientY, e);
    };
    const onMouseMove = (e: MouseEvent) => move(e.clientX, e.clientY);
    const onMouseUp = (e: MouseEvent) => up(e.clientX, e.clientY);
    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t && e.touches.length === 1) down(t.clientX, t.clientY, e);
    };
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t && gesture.current) {
        e.preventDefault();
        move(t.clientX, t.clientY);
      }
    };
    const onTouchEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      if (t) up(t.clientX, t.clientY);
    };
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const o2 = opts.current;
      if (e.key === 'Escape') {
        if (gesture.current?.type === 'place') {
          gesture.current = null;
          setScroll(true);
          pushLive(o2.drawings, null);
        }
        if (o2.tool !== 'cursor') o2.setTool('cursor');
        else if (o2.selected) o2.setSelected(null);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && o2.selected) {
        e.preventDefault();
        commit(
          o2.drawings.filter((d) => d.id !== o2.selected),
          null,
        );
      }
    };

    box.addEventListener('mousedown', onMouseDown, true);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    box.addEventListener('touchstart', onTouchStart, { capture: true, passive: false });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
    window.addEventListener('keydown', onKey);
    return () => {
      box.removeEventListener('mousedown', onMouseDown, true);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      box.removeEventListener('touchstart', onTouchStart, true);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('keydown', onKey);
    };
  }, [o.apiVersion]); // eslint-disable-line react-hooks/exhaustive-deps
}
