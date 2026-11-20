import { useMemo } from 'react';
import { formatDuration, zonedParts, zonedToUtc } from '../core/time';
import { SESSION_FILL, SESSION_SHORT, daySegments, hhmm, sessionStatus, useNow } from '../lib/sessions';

/**
 * The forex day at a glance: today's 24 hours in the trader's own time zone, coloured by
 * market session (computed in New York time, so daylight saving moves the bands correctly),
 * with a marker for now and the time left in the current session.
 */
export function SessionRibbon({ tz }: { tz: string }) {
  const now = useNow();
  const p = zonedParts(now, tz);
  const dayKey = `${p.year}-${p.month}-${p.day}`;
  const segments = useMemo(() => daySegments(p.year, p.month, p.day, tz), [dayKey, tz]); // eslint-disable-line react-hooks/exhaustive-deps
  const midnight = useMemo(() => zonedToUtc(p.year, p.month, p.day, 0, 0, tz), [dayKey, tz]); // eslint-disable-line react-hooks/exhaustive-deps
  const st = sessionStatus(now);
  const pos = Math.min(1, Math.max(0, (now - midnight) / 86_400));

  const label = st.weekend ? 'Market closed for the weekend' : st.current === 'Rollover' ? 'Rollover, spreads are wide' : `${st.current} session`;

  return (
    <div className="flex items-center gap-3" title="Today's forex sessions in your time zone">
      <div className="hidden w-[230px] lg:block">
        <div className="relative h-2.5 overflow-hidden rounded-full bg-ink-850" aria-hidden>
          <div className="absolute inset-0 flex gap-px">
            {segments.map((s) => (
              <div
                key={s.start}
                title={`${SESSION_SHORT[s.session]} ${hhmm(s.start)}–${hhmm(s.end)}`}
                className={`h-full ${s.session === 'London–NY overlap' ? 'session-overlap' : ''}`}
                style={{
                  flexGrow: s.end - s.start,
                  flexBasis: 0,
                  background: s.session === 'London–NY overlap' ? undefined : SESSION_FILL[s.session],
                  opacity: st.weekend ? 0.3 : s.session === st.current ? 1 : 0.5,
                }}
              />
            ))}
          </div>
          <div className="absolute top-[-2px] bottom-[-2px] w-[2px] rounded bg-fg shadow-[0_0_0_2px_var(--color-ink-950)]" style={{ left: `calc(${pos * 100}% - 1px)` }} />
        </div>
        <div className="mt-0.5 flex justify-between text-[10px] text-fg-3 type-data">
          <span>00</span>
          <span>06</span>
          <span>12</span>
          <span>18</span>
          <span>24</span>
        </div>
      </div>
      <div className="leading-tight">
        <div className="text-[13px] font-medium">{label}</div>
        <div className="text-[12px] text-fg-3">{st.weekend ? `Opens in ${formatDuration(st.left)}` : `${formatDuration(st.left)} left`}</div>
      </div>
    </div>
  );
}
