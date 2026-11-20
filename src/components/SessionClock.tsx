import { useId, useMemo } from 'react';
import { formatDuration, zonedParts, type SessionName } from '../core/time';
import { SESSION_FILL, SESSION_SHORT, daySegments, hhmm, sessionRanges, sessionStatus, useNow, type Segment } from '../lib/sessions';

const C = 100; // centre of the 200 x 200 dial
const R = 80; // ring radius (stroke centre line)
const GAP_MIN = 3; // surface gap between sessions, in minutes of arc on each side

const angle = (mins: number) => (mins / 1440) * Math.PI * 2 - Math.PI / 2;
const pt = (mins: number, r: number) => [C + r * Math.cos(angle(mins)), C + r * Math.sin(angle(mins))] as const;

function arc(start: number, end: number, r: number): string {
  const [x1, y1] = pt(start, r);
  const [x2, y2] = pt(end, r);
  const large = end - start > 720 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

/** Join a session cut by midnight into one arc (its end runs past 1440). */
function ringSegments(segments: Segment[]): Segment[] {
  if (segments.length > 1 && segments[0].session === segments[segments.length - 1].session) {
    const first = segments[0];
    const last = segments[segments.length - 1];
    return [...segments.slice(1, -1), { session: last.session, start: last.start, end: first.end + 1440 }];
  }
  return segments;
}

const LEGEND: SessionName[] = ['Asia', 'London', 'London–NY overlap', 'New York', 'Rollover'];

function Swatch({ session }: { session: SessionName }) {
  return (
    <span
      className={`inline-block h-3 w-3 shrink-0 rounded-[3px] ${session === 'London–NY overlap' ? 'session-overlap' : ''}`}
      style={session === 'London–NY overlap' ? undefined : { background: SESSION_FILL[session] }}
      aria-hidden
    />
  );
}

/**
 * A 24-hour dial of the forex day in the trader's own time zone: each session is an arc,
 * the London–New York overlap is hatched with both colours, and the marker shows now.
 */
export function SessionClock({ tz, size = 200 }: { tz: string; size?: number }) {
  const now = useNow(20_000);
  const p = zonedParts(now, tz);
  const dayKey = `${p.year}-${p.month}-${p.day}`;
  const segments = useMemo(() => daySegments(p.year, p.month, p.day, tz), [dayKey, tz]); // eslint-disable-line react-hooks/exhaustive-deps
  const ranges = useMemo(() => sessionRanges(segments), [segments]);
  const ring = useMemo(() => ringSegments(segments), [segments]);
  const st = sessionStatus(now);
  const nowMin = p.hour * 60 + p.minute;
  const hatch = `ovl${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  // Short names keep the centre clear of the 06 and 18 labels.
  const headline = st.weekend ? 'Market closed' : SESSION_SHORT[st.current];
  const sub = st.weekend ? `Opens in ${formatDuration(st.left)}` : `${formatDuration(st.left)} left`;
  const [mx1, my1] = pt(nowMin, R - 13);
  const [mx2, my2] = pt(nowMin, R + 12);

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <svg viewBox="0 0 200 200" width={size} height={size} role="img" aria-label={`Forex sessions today. Now ${hhmm(nowMin)}: ${st.weekend ? 'market closed' : `${st.current} session`}, ${sub}.`}>
        <defs>
          <pattern id={hatch} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="3" height="6" fill="var(--session-london)" />
            <rect x="3" width="3" height="6" fill="var(--session-ny)" />
          </pattern>
        </defs>
        {ring.map((s) => {
          const active = !st.weekend && s.session === st.current;
          return (
            <path
              key={s.start}
              d={arc(s.start + GAP_MIN, s.end - GAP_MIN, R)}
              fill="none"
              stroke={s.session === 'London–NY overlap' ? `url(#${hatch})` : SESSION_FILL[s.session]}
              strokeWidth={active ? 18 : 12}
              opacity={st.weekend ? 0.3 : active ? 1 : 0.72}
            >
              <title>{`${s.session}: ${hhmm(s.start)}–${hhmm(s.end % 1440)}`}</title>
            </path>
          );
        })}
        {Array.from({ length: 24 }, (_, h) => {
          const major = h % 6 === 0;
          const [x1, y1] = pt(h * 60, major ? 61 : 65);
          const [x2, y2] = pt(h * 60, 69);
          return <line key={h} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--color-fg-3)" strokeOpacity={major ? 0.9 : 0.45} strokeWidth={major ? 1.5 : 1} />;
        })}
        {[0, 6, 12, 18].map((h) => {
          const [x, y] = pt(h * 60, 51);
          return (
            <text key={h} x={x} y={y} dy="0.35em" textAnchor="middle" fontSize={10.5} fill="var(--color-fg-3)" className="type-data">
              {String(h).padStart(2, '0')}
            </text>
          );
        })}
        <line x1={mx1} y1={my1} x2={mx2} y2={my2} stroke="var(--color-ink-900)" strokeWidth={6} strokeLinecap="round" />
        <line x1={mx1} y1={my1} x2={mx2} y2={my2} stroke="var(--color-fg)" strokeWidth={2.5} strokeLinecap="round" />
        <text x={C} y={C - 7} textAnchor="middle" fontSize={28} fontWeight={700} fill="var(--color-fg)" className="type-data">
          {hhmm(nowMin)}
        </text>
        <text x={C} y={C + 16} textAnchor="middle" fontSize={12.5} fontWeight={600} fill="var(--color-fg-2)">
          {headline}
        </text>
        <text x={C} y={C + 31} textAnchor="middle" fontSize={11.5} fill="var(--color-fg-3)" className="type-data">
          {sub}
        </text>
      </svg>
      <ul className="space-y-1.5 text-[13px]" aria-label="Session times today">
        {LEGEND.filter((s) => ranges.has(s)).map((s) => {
          const [a, b] = ranges.get(s)!;
          const active = !st.weekend && s === st.current;
          return (
            <li key={s} className={`flex items-center gap-2 ${active ? 'font-semibold text-fg' : 'text-fg-2'}`}>
              <Swatch session={s} />
              <span className="w-[66px]">{SESSION_SHORT[s]}</span>
              <span className="type-data text-fg-3">
                {hhmm(a)}–{hhmm(b)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
