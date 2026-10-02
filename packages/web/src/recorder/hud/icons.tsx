/**
 * The manifest glyphs the extension draws (vendor/vitrinka-icons.js), as
 * React elements: 1em, currentColor, sized by the host's font.
 */
import type { ReactElement } from 'react';

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

export function CheckIcon(): ReactElement {
  return (
    <svg {...base}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function PauseIcon(): ReactElement {
  return (
    <svg {...base}>
      <rect x="14" y="4" width="4" height="16" rx="1" />
      <rect x="6" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

export function PlayIcon(): ReactElement {
  return (
    <svg {...base}>
      <path d="M6 4l14 8-14 8z" />
    </svg>
  );
}

export function PencilIcon(): ReactElement {
  return (
    <svg {...base}>
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
      <path d="m15 5 4 4" />
    </svg>
  );
}

export function AnnotateIcon(): ReactElement {
  return (
    <svg {...base}>
      <circle cx="12" cy="12" r="10" />
      <line x1="22" x2="18" y1="12" y2="12" />
      <line x1="6" x2="2" y1="12" y2="12" />
      <line x1="12" x2="12" y1="6" y2="2" />
      <line x1="12" x2="12" y1="22" y2="18" />
    </svg>
  );
}

export function CloseIcon(): ReactElement {
  return (
    <svg {...base}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

export function ArrowUpIcon(): ReactElement {
  return (
    <svg {...base}>
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </svg>
  );
}

export function MoreIcon(): ReactElement {
  return (
    <svg {...base}>
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </svg>
  );
}

export function NewTabIcon(): ReactElement {
  return (
    <svg {...base}>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

export function StopIcon(): ReactElement {
  return (
    <svg {...base}>
      <rect x="5" y="5" width="14" height="14" rx="2" />
    </svg>
  );
}

export function CircleCheckIcon(): ReactElement {
  return (
    <svg {...base}>
      <circle cx="12" cy="12" r="10" />
      <path d="m8 12.5 2.5 2.5L16 9.5" />
    </svg>
  );
}

export function CloudOffIcon(): ReactElement {
  return (
    <svg {...base}>
      <path d="m2 2 20 20" />
      <path d="M5.8 8.1A6 6 0 0 0 8 19h9.5a4.5 4.5 0 0 0 1.9-.4" />
      <path d="M21.5 15.6A4.5 4.5 0 0 0 17.5 10a6 6 0 0 0-7.4-3.8" />
    </svg>
  );
}

export function AlertIcon(): ReactElement {
  return (
    <svg {...base}>
      <path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

/** A ring with a gap; spun by `.spin`. */
export function SpinnerIcon(): ReactElement {
  return (
    <svg {...base} className="spinner spin">
      <circle cx="12" cy="12" r="10" />
    </svg>
  );
}

export function UnlinkIcon(): ReactElement {
  return (
    <svg {...base}>
      <path d="m18.8 12.7 1.7-1.7a5 5 0 0 0-7.1-7.1l-1.7 1.7" />
      <path d="m5.2 11.3-1.7 1.7a5 5 0 0 0 7.1 7.1l1.7-1.7" />
      <path d="M8 2v3" />
      <path d="M2 8h3" />
      <path d="M16 22v-3" />
      <path d="M22 16h-3" />
    </svg>
  );
}

export function HomeIcon(): ReactElement {
  return (
    <svg {...base}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9v11h14V9" />
    </svg>
  );
}
