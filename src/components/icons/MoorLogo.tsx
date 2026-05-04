export function MoorLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      {/* Crystal ball */}
      <circle cx="16" cy="11.5" r="9.5" fill="currentColor" />
      {/* Highlight crescent */}
      <path
        d="M 9 7 C 11 5.5 14 5.5 15 7 C 12.5 6.5 10.5 8 10 10.5 C 9.5 9 9 7.5 9 7 Z"
        fill="rgba(255,255,255,0.2)"
      />
      {/* Base / stand */}
      <path d="M 11.5 20.5 Q 16 19 20.5 20.5 L 19.5 24 Q 16 26 12.5 24 Z" fill="currentColor" />
      {/* Orange ribbon */}
      <path
        d="M 5 24 Q 10.5 26 16 24 Q 21.5 22 27 24"
        stroke="#f54e00"
        strokeWidth="1.2"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}
