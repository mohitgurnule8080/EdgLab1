import type { ReactNode, SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

function I({ children, size = 20, ...rest }: P & { children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>
      {children}
    </svg>
  );
}

export const ICursor = (p: P) => (
  <I {...p}>
    <path d="M12 3v6M12 15v6M3 12h6M15 12h6" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
  </I>
);
export const ITrend = (p: P) => (
  <I {...p}>
    <path d="M5.5 18.5L18.5 5.5" />
    <circle cx="5" cy="19" r="2" />
    <circle cx="19" cy="5" r="2" />
  </I>
);
export const IRay = (p: P) => (
  <I {...p}>
    <path d="M5.5 18.5L20 4" />
    <circle cx="5" cy="19" r="2" />
    <circle cx="12" cy="12" r="2" />
  </I>
);
export const IHLine = (p: P) => (
  <I {...p}>
    <path d="M3 12h7M14 12h7" />
    <circle cx="12" cy="12" r="2" />
  </I>
);
export const IVLine = (p: P) => (
  <I {...p}>
    <path d="M12 3v7M12 14v7" />
    <circle cx="12" cy="12" r="2" />
  </I>
);
export const IRect = (p: P) => (
  <I {...p}>
    <rect x="5" y="6" width="14" height="12" rx="1" />
    <circle cx="5" cy="6" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="19" cy="18" r="1.6" fill="currentColor" stroke="none" />
  </I>
);
export const IFib = (p: P) => (
  <I {...p}>
    <path d="M4 5h16M4 10h16M4 14h16M4 19h16" strokeWidth={1.3} />
    <path d="M6 19L18 5" strokeDasharray="2 2" />
  </I>
);
export const ILong = (p: P) => (
  <I {...p}>
    <rect x="4" y="4" width="16" height="16" rx="1.5" />
    <path d="M4 13h16" />
    <path d="M12 16V8M9 11l3-3 3 3" />
  </I>
);
export const IShort = (p: P) => (
  <I {...p}>
    <rect x="4" y="4" width="16" height="16" rx="1.5" />
    <path d="M4 11h16" />
    <path d="M12 8v8M9 13l3 3 3-3" />
  </I>
);
export const IMeasure = (p: P) => (
  <I {...p}>
    <path d="M3.5 16.5L16.5 3.5l4 4-13 13z" />
    <path d="M7 13l2 2M10 10l2 2M13 7l2 2" />
  </I>
);
export const IText = (p: P) => (
  <I {...p}>
    <path d="M5 6V4.5h14V6M12 4.5v15M9 19.5h6" />
  </I>
);
export const IMagnet = (p: P) => (
  <I {...p}>
    <path d="M6 4v8a6 6 0 0 0 12 0V4" />
    <path d="M6 8h4M14 8h4" />
    <path d="M10 4v8a2 2 0 0 0 4 0V4" />
  </I>
);
export const IStay = (p: P) => (
  <I {...p}>
    <path d="M14.5 4.5l5 5-8 8H6.5v-5z" />
    <path d="M4 20h16" />
  </I>
);
export const IEye = (p: P) => (
  <I {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="3" />
  </I>
);
export const IEyeOff = (p: P) => (
  <I {...p}>
    <path d="M4 4l16 16" />
    <path d="M10.6 5.6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.1 3.9M6.6 6.7C4 8.4 2.5 12 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.3-1.1" />
  </I>
);
export const ITrash = (p: P) => (
  <I {...p}>
    <path d="M4.5 7h15M10 4h4M6.5 7l1 13h9l1-13M10 11v6M14 11v6" />
  </I>
);
export const ISearch = (p: P) => (
  <I {...p}>
    <circle cx="10.5" cy="10.5" r="6" />
    <path d="M15 15l5 5" />
  </I>
);
export const IIndicators = (p: P) => (
  <I {...p}>
    <path d="M3 17c3-1 4-9 7-9s3 6 6 6 3-4 5-5" />
    <path d="M3 21h18" strokeOpacity={0.5} />
  </I>
);
export const IPlay = (p: P) => (
  <I {...p}>
    <path d="M7 5l12 7-12 7z" fill="currentColor" />
  </I>
);
export const IPause = (p: P) => (
  <I {...p}>
    <path d="M8 5v14M16 5v14" strokeWidth={3} />
  </I>
);
export const IForward = (p: P) => (
  <I {...p}>
    <path d="M5 5l9 7-9 7z" fill="currentColor" />
    <path d="M18 5v14" strokeWidth={2.4} />
  </I>
);
export const IFastForward = (p: P) => (
  <I {...p}>
    <path d="M3 6l8 6-8 6zM12 6l8 6-8 6z" fill="currentColor" />
  </I>
);
export const IStop = (p: P) => (
  <I {...p}>
    <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" />
  </I>
);
export const ISelectBar = (p: P) => (
  <I {...p}>
    <path d="M12 3v18" strokeDasharray="2 2" />
    <path d="M5 9v6M5 7v-2M5 17v2M19 9v6" strokeWidth={2} />
    <path d="M8 12h3M13 12h3" />
  </I>
);
export const IList = (p: P) => (
  <I {...p}>
    <path d="M8 6h12M8 12h12M8 18h12" />
    <circle cx="4" cy="6" r="1" fill="currentColor" />
    <circle cx="4" cy="12" r="1" fill="currentColor" />
    <circle cx="4" cy="18" r="1" fill="currentColor" />
  </I>
);
export const ITicket = (p: P) => (
  <I {...p}>
    <path d="M4 6h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4z" />
    <path d="M9 9l6 6M15 9l-6 6" strokeOpacity={0.7} />
  </I>
);
export const IMenu = (p: P) => (
  <I {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </I>
);
export const IChevronDown = (p: P) => (
  <I {...p}>
    <path d="M6 9l6 6 6-6" />
  </I>
);
export const IChevronUp = (p: P) => (
  <I {...p}>
    <path d="M6 15l6-6 6 6" />
  </I>
);
export const IClose = (p: P) => (
  <I {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </I>
);
export const IGear = (p: P) => (
  <I {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
  </I>
);
export const IPlus = (p: P) => (
  <I {...p}>
    <path d="M12 5v14M5 12h14" />
  </I>
);
