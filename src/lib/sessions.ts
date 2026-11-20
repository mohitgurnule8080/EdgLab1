import { useEffect, useState } from 'react';
import { sessionOf, zonedParts, zonedToUtc, type SessionName } from '../core/time';

/** Fill for each session, as CSS values (the overlap is drawn as a hatch of London and New York). */
export const SESSION_FILL: Record<SessionName, string> = {
  Asia: 'var(--session-asia)',
  London: 'var(--session-london)',
  'London–NY overlap': 'var(--session-london)',
  'New York': 'var(--session-ny)',
  Rollover: 'var(--session-rollover)',
};

export const SESSION_SHORT: Record<SessionName, string> = {
  Asia: 'Asia',
  London: 'London',
  'London–NY overlap': 'Overlap',
  'New York': 'New York',
  Rollover: 'Rollover',
};

/** Seconds since the epoch, refreshed every `everyMs`. */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

/** Forex is shut from Friday 17:00 to Sunday 17:00 New York time. */
export function isWeekend(utcSec: number): boolean {
  const ny = zonedParts(utcSec, 'America/New_York');
  return (ny.weekday === 5 && ny.hour >= 17) || ny.weekday === 6 || (ny.weekday === 0 && ny.hour < 17);
}

export interface Segment {
  session: SessionName;
  /** Minutes after local midnight. */
  start: number;
  end: number;
}

/** Today's local day split into session segments, at 15-minute resolution. */
export function daySegments(year: number, month: number, day: number, tz: string): Segment[] {
  const midnight = zonedToUtc(year, month, day, 0, 0, tz);
  const out: Segment[] = [];
  for (let i = 0; i < 96; i++) {
    const s = sessionOf(midnight + i * 900 + 450);
    const last = out[out.length - 1];
    if (last && last.session === s) last.end = (i + 1) * 15;
    else out.push({ session: s, start: i * 15, end: (i + 1) * 15 });
  }
  return out;
}

export interface SessionStatus {
  current: SessionName;
  weekend: boolean;
  /** Seconds until the current session ends (or, at the weekend, until the market opens). */
  left: number;
  next: SessionName;
}

export function sessionStatus(now: number): SessionStatus {
  const current = sessionOf(now);
  if (isWeekend(now)) {
    // The Sunday open falls on a quarter-hour boundary in every time zone.
    let t = now - (now % 900) + 900;
    for (let i = 0; i < 400 && isWeekend(t); i++) t += 900;
    return { current, weekend: true, left: t - now, next: sessionOf(t) };
  }
  for (let t = now + 60; t < now + 86_400; t += 60) {
    const s = sessionOf(t);
    if (s !== current) return { current, weekend: false, left: t - now, next: s };
  }
  return { current, weekend: false, left: 0, next: current };
}

/** Start and end (minutes after local midnight) of each session today; a session cut by midnight wraps. */
export function sessionRanges(segments: Segment[]): Map<SessionName, [number, number]> {
  const out = new Map<SessionName, [number, number]>();
  for (const s of new Set(segments.map((x) => x.session))) {
    const parts = segments.filter((x) => x.session === s);
    const first = parts[0];
    const last = parts[parts.length - 1];
    out.set(s, parts.length > 1 && first.start === 0 && last.end === 1440 ? [last.start, first.end] : [first.start, last.end]);
  }
  return out;
}

export const hhmm = (mins: number) => `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
