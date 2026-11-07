/** Compact inheritance indicators; the surrounding control supplies its title and accessible name. */
export function InheritanceIcon({ overridden = false }: { overridden?: boolean }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="m6.1 9.9 3.8-3.8M5.2 6.6 3.5 8.3a3 3 0 0 0 4.2 4.2l1.7-1.7M6.6 5.2l1.7-1.7a3 3 0 0 1 4.2 4.2l-1.7 1.7" />
        {overridden && <path d="M2 2 14 14" />}
      </g>
    </svg>
  );
}

export function ResetInheritanceIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 6a5.2 5.2 0 1 1 .6 5.2M3 2.5V6h3.5" />
      </g>
    </svg>
  );
}
