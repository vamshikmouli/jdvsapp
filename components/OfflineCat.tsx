// A cat asleep on the Wi-Fi router — shown when the internet drops.
// Pure SVG + CSS, no image file (it has to show when nothing can be downloaded).
// The same drawing is copied into public/offline.html for the service worker.

export function OfflineCat({ size = 230 }: { size?: number }) {
  return (
    <div style={{ width: size, margin: '0 auto' }} aria-hidden>
      <style>{`
        .oc-body { transform-origin: 112px 104px; animation: oc-breathe 2.4s ease-in-out infinite; }
        .oc-tail { transform-origin: 148px 106px; animation: oc-swish 3s ease-in-out infinite; }
        .oc-z { animation: oc-float 3s ease-in infinite; opacity: 0; }
        .oc-z2 { animation-delay: 1s; } .oc-z3 { animation-delay: 2s; }
        .oc-wifi { animation: oc-search 1.8s ease-in-out infinite; }
        .oc-led { animation: oc-blink 1s steps(2) infinite; }
        @keyframes oc-breathe { 0%,100% { transform: scale(1, 1); } 50% { transform: scale(1.03, 1.08); } }
        @keyframes oc-swish { 0%,100% { transform: rotate(0); } 50% { transform: rotate(-12deg); } }
        @keyframes oc-float { 0% { opacity: 0; transform: translate(0, 0) scale(.7); } 20% { opacity: 1; } 100% { opacity: 0; transform: translate(14px, -34px) scale(1.2); } }
        @keyframes oc-search { 0%,100% { opacity: .25; } 50% { opacity: .7; } }
        @keyframes oc-blink { 0% { opacity: 1; } 100% { opacity: .15; } }
        @media (prefers-reduced-motion: reduce) { .oc-body,.oc-tail,.oc-z,.oc-wifi,.oc-led { animation: none; } .oc-z { opacity: 1; } }
      `}</style>
      <svg viewBox="0 0 220 170" width="100%" role="img">
        {/* Wi-Fi signal, crossed out */}
        <g className="oc-wifi" stroke="#94A3B8" strokeWidth="5" fill="none" strokeLinecap="round">
          <path d="M84 40 a36 36 0 0 1 52 0" />
          <path d="M93 49 a23 23 0 0 1 34 0" />
          <circle cx="110" cy="58" r="3" fill="#94A3B8" stroke="none" />
        </g>
        <path d="M86 24 L134 64" stroke="#EF4444" strokeWidth="5" strokeLinecap="round" />
        {/* floor shadow */}
        <ellipse cx="110" cy="152" rx="72" ry="7" fill="#E9E5F5" />
        {/* router */}
        <path d="M68 116 L60 82 M152 116 L160 82" stroke="#94A3B8" strokeWidth="4" strokeLinecap="round" />
        <circle cx="60" cy="80" r="3.5" fill="#94A3B8" /><circle cx="160" cy="80" r="3.5" fill="#94A3B8" />
        <rect x="46" y="114" width="128" height="34" rx="9" fill="#E2E8F0" stroke="#CBD5E1" strokeWidth="2" />
        <circle cx="64" cy="131" r="3.5" fill="#CBD5E1" />
        <circle cx="78" cy="131" r="3.5" fill="#CBD5E1" />
        <circle className="oc-led" cx="92" cy="131" r="3.5" fill="#EF4444" />
        <rect x="120" y="128" width="40" height="6" rx="3" fill="#CBD5E1" />
        {/* sleeping cat */}
        <g className="oc-tail">
          <path d="M146 108 C 170 112, 172 92, 160 88" stroke="#E08A2C" strokeWidth="9" fill="none" strokeLinecap="round" />
        </g>
        <g className="oc-body">
          <ellipse cx="114" cy="104" rx="38" ry="15" fill="#F2A541" />
          <path d="M100 92 q8 -4 16 0 M112 91 q8 -4 16 1" stroke="#E08A2C" strokeWidth="3" fill="none" strokeLinecap="round" />
          <ellipse cx="96" cy="114" rx="9" ry="4.5" fill="#F7C47F" />
        </g>
        {/* head */}
        <path d="M68 86 L72 70 L82 82 Z" fill="#F2A541" />
        <path d="M88 82 L96 70 L98 86 Z" fill="#F2A541" />
        <path d="M71 84 L73 75 L79 82 Z" fill="#F9A8D4" />
        <circle cx="84" cy="96" r="16" fill="#F2A541" />
        <path d="M74 95 q4 3 8 0 M87 95 q4 3 8 0" stroke="#7C4A21" strokeWidth="2" fill="none" strokeLinecap="round" />
        <ellipse cx="84.5" cy="101" rx="2.4" ry="1.7" fill="#DB2777" />
        <path d="M84.5 103 q-2 3 -4 1 M84.5 103 q2 3 4 1" stroke="#7C4A21" strokeWidth="1.3" fill="none" strokeLinecap="round" />
        <path d="M66 100 h8 M66 104 h8 M95 100 h8 M95 104 h8" stroke="#B7791F" strokeWidth="1" strokeLinecap="round" />
        {/* z z z */}
        <text className="oc-z" x="104" y="78" fontSize="14" fontWeight="700" fill="#7C3AED" fontFamily="system-ui, sans-serif">z</text>
        <text className="oc-z oc-z2" x="104" y="78" fontSize="17" fontWeight="700" fill="#7C3AED" fontFamily="system-ui, sans-serif">z</text>
        <text className="oc-z oc-z3" x="104" y="78" fontSize="20" fontWeight="700" fill="#7C3AED" fontFamily="system-ui, sans-serif">Z</text>
      </svg>
    </div>
  );
}
