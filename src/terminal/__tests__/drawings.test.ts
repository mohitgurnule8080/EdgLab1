import { describe, expect, it } from 'vitest';
import { createDrawing, dragDrawing, fibPrice, handlesOf, hitHandle, hitTest, newPosition, positionStats, type PaneMap } from '../drawings';

// A simple pane: 1 pixel per second of time, 100 pixels per price unit, price 0 at y = 500.
const map: PaneMap = { width: 1000, height: 500, x: (t) => t, y: (p) => 500 - p * 100 };

describe('position tool', () => {
  it('starts with a 1.5 ATR stop and a 2R target on the right side', () => {
    const long = newPosition('long', { t: 100, p: 2 }, 0.2, 60);
    expect(long.stop).toBeCloseTo(1.7, 10);
    expect(long.target).toBeCloseTo(2.6, 10);
    expect(long.b!.t).toBe(100 + 20 * 60);
    const short = newPosition('short', { t: 100, p: 2 }, 0.2, 60);
    expect(short.stop).toBeCloseTo(2.3, 10);
    expect(positionStats(short).rr).toBeCloseTo(2, 10);
  });

  it('keeps the stop and target on the right side of the entry when dragged', () => {
    const long = newPosition('long', { t: 0, p: 2 }, 0.2, 60);
    // Dragging the stop above the entry pins it just under the entry.
    expect(dragDrawing(long, 'stop', { t: 0, p: 1.7 }, { t: 0, p: 2.5 }).stop!).toBeLessThan(2);
    // Dragging the target below the entry pins it just above.
    expect(dragDrawing(long, 'target', { t: 0, p: 2.6 }, { t: 0, p: 1 }).target!).toBeGreaterThan(2);
    // Moving the entry cannot jump past the stop.
    expect(dragDrawing(long, 'a', { t: 0, p: 2 }, { t: 10, p: 1 }).a.p).toBeGreaterThan(long.stop!);
  });

  it('moves everything together when the body is dragged', () => {
    const long = newPosition('long', { t: 0, p: 2 }, 0.2, 60);
    const moved = dragDrawing(long, null, { t: 0, p: 2 }, { t: 30, p: 2.5 });
    expect(moved.a).toEqual({ t: 30, p: 2.5 });
    expect(moved.stop).toBeCloseTo(long.stop! + 0.5, 10);
    expect(moved.target).toBeCloseTo(long.target! + 0.5, 10);
    expect(moved.b!.t).toBe(long.b!.t + 30);
  });
});

describe('hit testing', () => {
  it('finds a trend line near the segment and not past its ends', () => {
    const d = createDrawing('trend', { t: 100, p: 1 }, { t: 300, p: 3 });
    expect(hitTest([d], map, 200, 300)).toBe(d); // on the line (p = 2 at t = 200)
    expect(hitTest([d], map, 200, 320)).toBeNull(); // 20 px away
    expect(hitTest([d], map, 400, 100)).toBeNull(); // past the end
  });

  it('finds horizontal lines anywhere along their price and rectangles inside', () => {
    const h = createDrawing('hline', { t: 0, p: 2 });
    const r = createDrawing('rect', { t: 500, p: 4 }, { t: 700, p: 3 });
    expect(hitTest([h, r], map, 900, 302)).toBe(h);
    expect(hitTest([h, r], map, 600, 150)).toBe(r);
  });

  it('prefers the topmost drawing and exposes corner handles of rectangles', () => {
    const a = createDrawing('rect', { t: 0, p: 4 }, { t: 400, p: 0 });
    const b = createDrawing('rect', { t: 100, p: 3 }, { t: 200, p: 2 });
    expect(hitTest([a, b], map, 150, 250)).toBe(b);
    expect(handlesOf(a, map).map((h) => h.id)).toEqual(['a', 'b', 'ab', 'ba']);
    expect(hitHandle(a, map, 402, 498)?.id).toBe('b');
  });
});

describe('Fibonacci levels', () => {
  it('puts 0 at the second point and 1 at the first', () => {
    const f = createDrawing('fib', { t: 0, p: 1 }, { t: 100, p: 2 });
    expect(fibPrice(f, 0)).toBe(2);
    expect(fibPrice(f, 1)).toBe(1);
    expect(fibPrice(f, 0.618)).toBeCloseTo(1.382, 10);
  });
});
