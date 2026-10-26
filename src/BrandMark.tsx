/*! Designed by Oladievic */
import type { SVGProps } from 'react';

export function BrandMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 48 48" fill="none" aria-hidden="true" {...props}>
      <path
        className="brand-cut-left"
        d="M4 5h12c9 0 15 7.5 15 19s-6 19-15 19H4V5Zm9 9v20h3c4 0 6-4 6-10s-2-10-6-10h-3Z"
        fill="currentColor"
        fillRule="evenodd"
      />
      <path
        className="brand-cut-right"
        d="M32 5h12L32 24l12 19H32L20 24 32 5Z"
        fill="currentColor"
      />
    </svg>
  );
}
