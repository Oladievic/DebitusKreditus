import { forwardRef, type ReactNode, type SVGProps } from 'react';

export type IconProps = SVGProps<SVGSVGElement> & {
  size?: number | string;
  title?: string;
};

function icon(name: string, drawing: ReactNode) {
  const Component = forwardRef<SVGSVGElement, IconProps>(function LedgerIcon(
    { size = 24, strokeWidth = 1.7, title, ...props },
    ref,
  ) {
    const labelled = Boolean(title || props['aria-label'] || props['aria-labelledby']);
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="square"
        strokeLinejoin="bevel"
        aria-hidden={labelled ? undefined : true}
        role={labelled ? 'img' : undefined}
        focusable="false"
        {...props}
      >
        {title && <title>{title}</title>}
        {drawing}
      </svg>
    );
  });
  Component.displayName = name;
  return Component;
}

const sheet = (
  <>
    <path d="M4 3.5h11l5 5V20.5H4V3.5ZM15 3.5V9h5" />
    <path d="M1.5 7v16H16" opacity=".28" />
  </>
);
const ring = <path d="M18.6 5.75a9 9 0 1 0 2.15 9.5M21 10.5a9 9 0 0 0-.85-2.6" />;

export const ArrowRight = icon(
  'ArrowRight',
  <>
    <path d="M4 12h14.5M13 5.5l6.5 6.5-6.5 6.5" />
    <path d="M4 9.25v5.5" opacity=".35" />
  </>,
);
export const ArrowLeft = icon(
  'ArrowLeft',
  <>
    <path d="M20 12H5.5M11 5.5 4.5 12l6.5 6.5" />
    <path d="M20 9.25v5.5" opacity=".35" />
  </>,
);
export const ArrowDown = icon(
  'ArrowDown',
  <>
    <path d="M12 4v14.5M5.5 13l6.5 6.5 6.5-6.5" />
    <path d="M9.25 4h5.5" opacity=".35" />
  </>,
);
export const ArrowUpRight = icon(
  'ArrowUpRight',
  <>
    <path d="m5 19 13-13M9.5 4.5h10v10" />
    <path d="M4.5 14.75v4.75h4.75" opacity=".35" />
  </>,
);
export const ArrowDownRight = icon(
  'ArrowDownRight',
  <>
    <path d="M5 5 18 18M9.5 19.5h10v-10" />
    <path d="M4.5 9.25V4.5h4.75" opacity=".35" />
  </>,
);
export const ArrowDownToLine = icon(
  'ArrowDownToLine',
  <>
    <path d="M12 3.5v12.25M6.75 11.25 12 16.5l5.25-5.25" />
    <path d="M4.25 17.25v3.25h15.5v-3.25" />
  </>,
);
export const Upload = icon(
  'Upload',
  <>
    <path d="M12 16.5V4.25M6.75 9.25 12 4l5.25 5.25" />
    <path d="M4.25 16v4.5h15.5V16" />
  </>,
);
export const ChevronRight = icon('ChevronRight', <path d="m8.75 5.25 6.75 6.75-6.75 6.75" />);
export const ChevronDown = icon('ChevronDown', <path d="m5.25 8.75 6.75 6.75 6.75-6.75" />);
export const Check = icon(
  'Check',
  <>
    <path d="m4.25 12.25 4.5 4.5L19.75 6" />
    <path d="M4.25 16.75h4.5" opacity=".28" />
  </>,
);
export const Plus = icon(
  'Plus',
  <>
    <path d="M12 4.5v15M4.5 12h15" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
  </>,
);
export const X = icon(
  'X',
  <>
    <path d="m5.75 5.75 12.5 12.5M18.25 5.75l-12.5 12.5" />
    <path d="M4 4h3.5M20 20h-3.5" opacity=".3" />
  </>,
);
export const Play = icon(
  'Play',
  <>
    <path d="M6.25 3.75 20 11.5v1L6.25 20.25V3.75Z" />
    <path d="M10 9.25v5.5" opacity=".35" />
  </>,
);
export const Pause = icon(
  'Pause',
  <>
    <path d="M5.25 4h3.5l1 1v15h-4.5V4ZM14.25 4h3.5l1 1v15h-4.5V4Z" />
    <path d="M5.25 16.5h4.5M14.25 16.5h4.5" opacity=".35" />
  </>,
);

export const FileText = icon(
  'FileText',
  <>
    {sheet}
    <path d="M8 12.5h7.5M8 16h5" />
  </>,
);
export const FileJson = icon(
  'FileJson',
  <>
    {sheet}
    <path d="M10 11.25H9v2l-1 1 1 1v2h1M14 11.25h1v2l1 1-1 1v2h-1" />
  </>,
);
export const FileCheck2 = icon(
  'FileCheck2',
  <>
    <path d="M11 3.25H6.5a2 2 0 0 0-2 2v13.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-6" />
    <path d="M8 13h4M8 16.5h7.5m-1.75-9 2.5 2.5 5-6" />
  </>,
);
export const FilePlus2 = icon(
  'FilePlus2',
  <>
    <path d="M11 3.25H6.5a2 2 0 0 0-2 2v13.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-6" />
    <path d="M8 13h4M8 16.5h7.5M17.25 3v7M13.75 6.5h7" />
  </>,
);
export const FileSearch = icon(
  'FileSearch',
  <>
    <path d="M12.5 3.25h-6a2 2 0 0 0-2 2v13.5a2 2 0 0 0 2 2h8M12.5 3.25V8h5" />
    <circle cx="16" cy="13" r="3.5" />
    <path d="m18.5 15.5 3 3M8 12h2M8 16h2" />
  </>,
);
export const Copy = icon(
  'Copy',
  <>
    <path d="M8.25 8.25h9.5l3 3v9H8.25v-12Z" />
    <path d="M15.5 4.5v-1h-12v12H5M17.75 8.25v3h3" />
    <path d="M11.75 15h5" opacity=".45" />
  </>,
);
export const BookOpen = icon(
  'BookOpen',
  <>
    <path d="M12 6.5C9.5 4.75 6.25 4.25 3.75 5v13c3-.5 5.75 0 8.25 1.5 2.5-1.5 5.25-2 8.25-1.5V5c-2.5-.75-5.75-.25-8.25 1.5V19" />
    <path d="M6.75 8.5 9 9M15 9l2.25-.5M6.75 12 9 12.5" opacity=".5" />
  </>,
);
export const Newspaper = icon(
  'Newspaper',
  <>
    <path d="M16.75 20.25H5.5a2 2 0 0 1-2-2v-14h13.25v14a2 2 0 0 0 4 0V8.5h-1.5" />
    <path d="M7 8h6.25M7 11.5h2.75v4H7zM12.5 11.5H14M12.5 15H14" />
  </>,
);

export const CircleCheck = icon(
  'CircleCheck',
  <>
    {ring}
    <path d="m7.25 12 3.25 3.25 7-8" />
  </>,
);
export const CircleHelp = icon(
  'CircleHelp',
  <>
    {ring}
    <path d="M9 8.75a3 3 0 0 1 5.75 1c0 2-2.75 2.15-2.75 4" />
    <circle cx="12" cy="17.2" r=".9" fill="currentColor" stroke="none" />
  </>,
);
export const CircleMinus = icon(
  'CircleMinus',
  <>
    {ring}
    <path d="M7.5 12h9" />
  </>,
);
export const Info = icon(
  'Info',
  <>
    {ring}
    <path d="M10.5 11h1.75v6M10.5 17h3.75" />
    <circle cx="12" cy="7.5" r=".9" fill="currentColor" stroke="none" />
  </>,
);
export const Clock3 = icon(
  'Clock3',
  <>
    {ring}
    <path d="M12 6.5v6h4.75" />
    <path d="M4.5 12H6M12 19v1.5" opacity=".4" />
  </>,
);
export const LoaderCircle = icon(
  'LoaderCircle',
  <>
    <path d="M12 3a9 9 0 0 1 9 9" />
    <path d="M20.5 15A9 9 0 1 1 8.5 3.7" opacity=".25" />
    <circle cx="21" cy="12" r="1.15" fill="currentColor" stroke="none" />
  </>,
);
export const RefreshCw = icon(
  'RefreshCw',
  <>
    <path d="M19.5 8.75A8 8 0 0 0 5.75 6.5M4.5 15.25a8 8 0 0 0 13.75 2.25" />
    <path d="M19.75 3.75v5.5h-5.5M4.25 20.25v-5.5h5.5" />
  </>,
);
export const Search = icon(
  'Search',
  <>
    <path d="M16.75 10.25a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z" />
    <path d="m15 15 5.25 5.25M7.25 8a3.75 3.75 0 0 1 3-1.5" opacity=".6" />
  </>,
);
export const Bell = icon(
  'Bell',
  <>
    <path d="M5.25 15.75V10a6.75 6.75 0 0 1 13.5 0v2.25M5.25 15.75l-2 2h17.5l-2-2M9.5 20.5h5M11 2h2" />
    <circle cx="18.75" cy="14.1" r=".8" fill="currentColor" stroke="none" />
  </>,
);

export const Home = icon(
  'Home',
  <>
    <path d="M3.5 3.5h10v10h-10zM16.5 3.5h4v17h-4M3.5 16.5h10v4h-10" />
    <path d="m6.5 10 4-4" strokeWidth="2.3" />
  </>,
);
export const LayoutGrid = icon(
  'LayoutGrid',
  <>
    <path d="M3 3.5h7v7H3zM14 3.5h7l-7 7v-7ZM3 14h7v7H3zM14 14h7v7h-7z" />
    <path d="M14 14h7v7" strokeWidth="3" />
  </>,
);
export const Menu = icon(
  'Menu',
  <>
    <path d="M4.5 5.5h15M4.5 12H16M4.5 18.5h15" />
    <path d="M4.5 5.5v13" opacity=".24" />
  </>,
);
export const Building2 = icon(
  'Building2',
  <>
    <path d="M3.5 20.5V8l8-4.5v17M11.5 8h5l4 4v8.5M2 20.5h20" />
    <path d="M7.5 9v2M7.5 14v2M16 13h2M16 17h2" />
  </>,
);
export const Landmark = icon(
  'Landmark',
  <>
    <path d="M3 8h18L12 3 3 8ZM5 11v7M12 11v7M19 11v7M3 21h18" />
    <path d="M3 11h4M10 11h4M17 11h4" strokeWidth="2.7" />
  </>,
);
export const Wallet = icon(
  'Wallet',
  <>
    <path d="M19.75 8.25V5.5a2 2 0 0 0-2-2L5 6.5M19.75 8.25H5a1.75 1.75 0 0 1 0-3.5M3.25 6.5v12a2 2 0 0 0 2 2h14.5v-4.25" />
    <path d="M21 10.5h-6.25l-2 2.75 2 2.5H21V10.5Z" />
    <circle cx="16.5" cy="13.1" r=".85" fill="currentColor" stroke="none" />
  </>,
);
export const UserRound = icon(
  'UserRound',
  <>
    <path d="M16.15 7.1a4.15 4.15 0 1 1-8.3 0 4.15 4.15 0 0 1 8.3 0ZM4.25 20.5v-2a5.25 5.25 0 0 1 5.25-5.25h5a5.25 5.25 0 0 1 5.25 5.25v2H4.25Z" />
    <path d="M9 17h6" opacity=".35" />
  </>,
);
export const LogOut = icon(
  'LogOut',
  <>
    <path d="M11.25 4.25h-7v15.5h7M9.5 12h11M16.5 7.25 21.25 12 16.5 16.75" />
    <path d="M4.25 4.25 7 6v12l-2.75 1.75" opacity=".4" />
  </>,
);

export const ShieldCheck = icon(
  'ShieldCheck',
  <>
    <path d="M12 2.75 20 6v6.25c0 4-3.5 6.75-8 9-4.5-2.25-8-5-8-9V6l8-3.25Z" />
    <path d="m8 11.5 2.75 2.75 5.5-5.5" />
  </>,
);
export const LockKeyhole = icon(
  'LockKeyhole',
  <>
    <path d="M7.25 10.25v-3.5a4.75 4.75 0 0 1 9.5 0v3.5M4.25 10.25h15.5V20.5H4.25z" />
    <circle cx="12" cy="14.5" r="1.3" />
    <path d="M12 15.75v1.75" />
  </>,
);
export const KeyRound = icon(
  'KeyRound',
  <>
    <path d="M14.25 4.25a5.5 5.5 0 0 1 4.5 9.5 5.5 5.5 0 0 1-6.25 1L7 20.25H3.75V17l5.5-5.5a5.5 5.5 0 0 1 5-7.25Z" />
    <path d="m7.25 16.75 2 2" />
    <circle cx="16" cy="8.5" r="1" fill="currentColor" stroke="none" />
  </>,
);
export const Plug = icon(
  'Plug',
  <>
    <path d="M9 3H3v6l6 6 6-6-6-6ZM15 21h6v-6l-6-6-6 6 6 6Z" />
    <path d="m8 16 8-8" strokeWidth="2.5" />
  </>,
);
export const Cpu = icon(
  'Cpu',
  <>
    <path d="M6 4h10l4 4v12H4V6M8 1v3M14 1v3M8 20v3M14 20v3M1 9h3M1 15h3M20 9h3M20 15h3" />
    <path d="M9 8h6v8H9zM6 4l-2 2" />
    <path d="m10 12 1 1 3-3" strokeWidth="1.2" />
  </>,
);

export const Pencil = icon(
  'Pencil',
  <>
    <path d="m4.25 15.5 11.5-11.5a1.75 1.75 0 0 1 2.5 0l1.75 1.75a1.75 1.75 0 0 1 0 2.5l-11.5 11.5-5.25 1 1-5.25Z" />
    <path d="m13.5 6.25 4.25 4.25M4.25 15.5l4.25 4.25" />
    <path d="M13 20.75h7.75" opacity=".4" />
  </>,
);
export const Trash2 = icon(
  'Trash2',
  <>
    <path d="M4 6.75h16M8.25 6.75v-3h7.5v3M5.5 9.25l.75 11h11.5l.75-11M9.5 10.75v6.5M14.5 10.75v6.5" />
  </>,
);
export const Settings2 = icon(
  'Settings2',
  <>
    <path d="M3.5 7.25h7M15.5 7.25h5M3.5 16.75h3M11.5 16.75h9" />
    <circle cx="13" cy="7.25" r="2.5" />
    <circle cx="9" cy="16.75" r="2.5" />
    <path d="M13 3.5v1.25M9 19.25v1.25" opacity=".45" />
  </>,
);
export const SlidersHorizontal = icon(
  'SlidersHorizontal',
  <>
    <path d="M3.5 5.5h3M10.5 5.5h10M3.5 12h10M17.5 12h3M3.5 18.5h5M12.5 18.5h8" />
    <path d="M6.5 3.75h4v3.5h-4zM13.5 10.25h4v3.5h-4zM8.5 16.75h4v3.5h-4z" />
  </>,
);
export const Scale = icon(
  'Scale',
  <>
    <path d="M12 3.25V20M7.75 20.25h8.5M4.25 7.25l15.5-2M5.75 7l-3 7h6l-3-7ZM18.25 5.5l-3 7h6l-3-7Z" />
    <path d="M3 16.25h5.5M15.5 14.75H21" opacity=".4" />
  </>,
);
export const TrendingUp = icon(
  'TrendingUp',
  <>
    <path d="m3.75 17.75 6-6 4 3.5 6.5-9M14.5 6.25h6v6" />
    <path d="M4 21h16" opacity=".3" />
  </>,
);

export const Moon = icon(
  'Moon',
  <>
    <path d="M18.75 15.25a8.25 8.25 0 0 1-10-10.75 8.5 8.5 0 1 0 11 11.25" />
    <path d="M16.5 4v4M14.5 6h4" opacity=".65" />
  </>,
);
export const Sun = icon(
  'Sun',
  <>
    <path d="m9.75 7 4.5 0 2.75 2.75v4.5L14.25 17h-4.5L7 14.25v-4.5L9.75 7Z" />
    <path d="M12 1.75V4M12 20v2.25M1.75 12H4M20 12h2.25M4.75 4.75l1.5 1.5M17.75 17.75l1.5 1.5M4.75 19.25l1.5-1.5M17.75 6.25l1.5-1.5" />
  </>,
);
export const Sparkles = icon(
  'Sparkles',
  <>
    <path d="m10 4.25 1.75 5.5 5.5 1.75-5.5 1.75-1.75 5.5-1.75-5.5-5.5-1.75 5.5-1.75L10 4.25Z" />
    <path d="M18.75 2.5v5M16.25 5h5M19 16.75v4.5M16.75 19h4.5" />
  </>,
);
