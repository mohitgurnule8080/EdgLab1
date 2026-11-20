export interface Timeframe {
  id: string;
  sec: number;
}

export const TIMEFRAMES: Timeframe[] = [
  { id: 'M1', sec: 60 },
  { id: 'M5', sec: 300 },
  { id: 'M15', sec: 900 },
  { id: 'M30', sec: 1800 },
  { id: 'H1', sec: 3600 },
  { id: 'H4', sec: 14_400 },
  { id: 'D1', sec: 86_400 },
  { id: 'W1', sec: 604_800 },
];

export function tfLabel(sec: number): string {
  const tf = TIMEFRAMES.find((t) => t.sec === sec);
  if (tf) return tf.id;
  if (sec % 3600 === 0) return `H${sec / 3600}`;
  if (sec % 60 === 0) return `M${sec / 60}`;
  return `${sec}s`;
}

// 1970-01-01 was a Thursday, so Monday 00:00 UTC is 4 days after the epoch.
const WEEK_OFFSET = 4 * 86_400;

/** Start time of the bucket of `tfSec` seconds that contains `time` (weeks start Monday 00:00 UTC). */
export function bucketStart(time: number, tfSec: number): number {
  if (tfSec === 604_800) {
    return Math.floor((time - WEEK_OFFSET) / tfSec) * tfSec + WEEK_OFFSET;
  }
  return Math.floor(time / tfSec) * tfSec;
}

// ---------------------------------------------------------------------------
// Time zones (all internal times are UTC seconds; Intl does the DST maths)
// ---------------------------------------------------------------------------

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    formatters.set(tz, f);
  }
  return f;
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday ... 6 = Saturday */
  weekday: number;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function zonedParts(utcSec: number, tz: string): ZonedParts {
  const parts = partsFormatter(tz).formatToParts(new Date(utcSec * 1000));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: WEEKDAYS.indexOf(get('weekday')),
  };
}

/** Convert a wall-clock time in `tz` to UTC seconds. */
export function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, tz: string): number {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute) / 1000;
  let guess = asUtc;
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(guess, tz);
    const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) / 1000;
    const diff = wall - asUtc;
    if (diff === 0) break;
    guess -= diff;
  }
  return guess;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "2024-03-15" in the given zone. */
export function dateKey(utcSec: number, tz: string): string {
  const p = zonedParts(utcSec, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** "2024-03-15T09:30", the value format of <input type="datetime-local">. */
export function toLocalInput(utcSec: number, tz: string): string {
  const p = zonedParts(utcSec, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

export function fromLocalInput(value: string, tz: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  return zonedToUtc(+m[1], +m[2], +m[3], +m[4], +m[5], tz);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDateTime(utcSec: number, tz: string, withYear = true): string {
  const p = zonedParts(utcSec, tz);
  const date = `${p.day} ${MONTHS[p.month - 1]}${withYear ? ` ${p.year}` : ''}`;
  return `${date}, ${pad(p.hour)}:${pad(p.minute)}`;
}

export function formatDate(utcSec: number, tz: string): string {
  const p = zonedParts(utcSec, tz);
  return `${p.day} ${MONTHS[p.month - 1]} ${p.year}`;
}

export function monthName(month: number): string {
  return MONTHS[month - 1];
}

export function weekdayName(weekday: number): string {
  return WEEKDAYS[weekday];
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '0m';
  const d = Math.floor(sec / 86_400);
  const h = Math.floor((sec % 86_400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ---------------------------------------------------------------------------
// Trading sessions, defined in New York time so daylight saving is handled.
// ---------------------------------------------------------------------------

export type SessionName = 'Asia' | 'London' | 'London–NY overlap' | 'New York' | 'Rollover';

export const SESSION_ORDER: SessionName[] = ['Asia', 'London', 'London–NY overlap', 'New York', 'Rollover'];

/** Session of a moment, by New York hour: Asia 19-03, London 03-08, overlap 08-12, NY 12-17, rollover 17-19. */
export function sessionOf(utcSec: number): SessionName {
  const h = zonedParts(utcSec, 'America/New_York').hour;
  if (h >= 19 || h < 3) return 'Asia';
  if (h < 8) return 'London';
  if (h < 12) return 'London–NY overlap';
  if (h < 17) return 'New York';
  return 'Rollover';
}
