/** Logo Infra Design (inline SVG) — rzut/siatka + trasa instalacji z węzłami. */
export function Logo({ className }: { className?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 512 512" className={className} role="img" aria-label="Infra Design">
      <defs>
        <linearGradient id="ifd-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0e1830" />
          <stop offset="1" stopColor="#0b1220" />
        </linearGradient>
        <linearGradient id="ifd-teal" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5eead4" />
          <stop offset="1" stopColor="#2dd4bf" />
        </linearGradient>
      </defs>
      <rect x="24" y="24" width="464" height="464" rx="96" fill="url(#ifd-bg)" stroke="#2dd4bf" strokeOpacity="0.35" strokeWidth="4" />
      <g stroke="#2dd4bf" strokeOpacity="0.12" strokeWidth="3">
        <path d="M120 64 V448 M256 64 V448 M392 64 V448" />
        <path d="M64 152 H448 M64 296 H448" />
      </g>
      <path d="M120 360 V200 H300 V152" fill="none" stroke="#94a3b8" strokeOpacity="0.45" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M152 360 H296 V232 H392" fill="none" stroke="url(#ifd-teal)" strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" />
      <g fill="url(#ifd-teal)">
        <rect x="138" y="346" width="28" height="28" rx="6" />
        <circle cx="296" cy="232" r="18" />
        <path d="M392 214 l18 36 h-36 z" />
      </g>
    </svg>
  )
}
