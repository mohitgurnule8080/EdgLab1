import type { ReactNode, SVGProps } from 'react';

/** One consistent line-icon set: 24px grid, 1.8 stroke, round caps. */
function Icon({ children, size = 18, ...rest }: SVGProps<SVGSVGElement> & { size?: number; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>
      {children}
    </svg>
  );
}

type P = SVGProps<SVGSVGElement> & { size?: number };

export const IconDashboard = (p: P) => (
  <Icon {...p}>
    <rect x="3" y="3" width="7.5" height="9" rx="1.5" />
    <rect x="13.5" y="3" width="7.5" height="5.5" rx="1.5" />
    <rect x="13.5" y="11.5" width="7.5" height="9.5" rx="1.5" />
    <rect x="3" y="15" width="7.5" height="6" rx="1.5" />
  </Icon>
);
export const IconMarkets = (p: P) => (
  <Icon {...p}>
    <path d="M3 17l5-5 4 3 8-9" />
    <path d="M15 6h5v5" />
    <path d="M3 21h18" />
  </Icon>
);
export const IconReplay = (p: P) => (
  <Icon {...p}>
    <path d="M4 5v6h6" />
    <path d="M4.6 11A8 8 0 1 0 7 5.6L4 8" />
    <path d="M11 9l4 3-4 3z" fill="currentColor" stroke="none" />
  </Icon>
);
export const IconJournal = (p: P) => (
  <Icon {...p}>
    <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z" />
    <path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3" />
    <path d="M9 8h6M9 11.5h4" />
  </Icon>
);
export const IconData = (p: P) => (
  <Icon {...p}>
    <ellipse cx="12" cy="5.5" rx="7.5" ry="2.5" />
    <path d="M4.5 5.5v6.5c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5V5.5" />
    <path d="M4.5 12v6.5c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5V12" />
  </Icon>
);
export const IconSettings = (p: P) => (
  <Icon {...p}>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </Icon>
);
export const IconSun = (p: P) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
  </Icon>
);
export const IconMoon = (p: P) => (
  <Icon {...p}>
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
  </Icon>
);
export const IconLock = (p: P) => (
  <Icon {...p}>
    <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
  </Icon>
);
export const IconClock = (p: P) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Icon>
);
export const IconTrendUp = (p: P) => (
  <Icon {...p}>
    <path d="M3 17l6-6 4 4 8-8" />
    <path d="M15 7h6v6" />
  </Icon>
);
export const IconTarget = (p: P) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4.5" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
  </Icon>
);
export const IconFlame = (p: P) => (
  <Icon {...p}>
    <path d="M12 21c-3.9 0-6.5-2.6-6.5-6.1 0-3.5 2.6-5.3 3.9-8.4.4 2 1.6 3.1 2.8 3.6.3-2.7 1.3-5 3.2-7.1.4 3.4 4.1 6 4.1 10.6 0 4.6-3.1 7.4-7.5 7.4z" />
  </Icon>
);
export const IconCalendar = (p: P) => (
  <Icon {...p}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
    <path d="M3.5 9.5h17M8 3v4M16 3v4" />
  </Icon>
);
export const IconShield = (p: P) => (
  <Icon {...p}>
    <path d="M12 3l7.5 3v5.6c0 4.4-3.1 8.1-7.5 9.4-4.4-1.3-7.5-5-7.5-9.4V6z" />
    <path d="M9 12l2 2 4-4" />
  </Icon>
);
export const IconArrowRight = (p: P) => (
  <Icon {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
);
export const IconChart = (p: P) => (
  <Icon {...p}>
    <path d="M7 4v3M7 15v5M17 3v4M17 13v4" />
    <rect x="4.5" y="7" width="5" height="8" rx="1" />
    <rect x="14.5" y="7" width="5" height="6" rx="1" />
  </Icon>
);
