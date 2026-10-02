// A cheeky puppy that has pulled the plug — shown on the error screens.
// Pure SVG + CSS (no image file, no Tailwind) so it also works in global-error,
// which replaces the whole document. Animations stop for "reduce motion" users.

export function OopsPuppy({ size = 220 }: { size?: number }) {
  return (
    <div style={{ width: size, margin: '0 auto' }} aria-hidden>
      <style>{`
        .op-tail { transform-origin: 150px 98px; animation: op-wag .35s ease-in-out infinite alternate; }
        .op-head { transform-origin: 92px 92px; animation: op-bob 1.6s ease-in-out infinite; }
        .op-ear-l { transform-origin: 74px 62px; animation: op-flop 1.6s ease-in-out infinite; }
        .op-ear-r { transform-origin: 108px 62px; animation: op-flop 1.6s ease-in-out infinite reverse; }
        .op-eye { transform-origin: center; transform-box: fill-box; animation: op-blink 3.2s infinite; }
        .op-spark { animation: op-spark .5s steps(2) infinite; }
        .op-spark2 { animation: op-spark .5s steps(2) .25s infinite; }
        .op-tongue { transform-origin: 96px 96px; animation: op-pant .4s ease-in-out infinite alternate; }
        @keyframes op-wag { from { transform: rotate(-18deg); } to { transform: rotate(22deg); } }
        @keyframes op-bob { 0%,100% { transform: translateY(0) rotate(0); } 50% { transform: translateY(-3px) rotate(-4deg); } }
        @keyframes op-flop { 0%,100% { transform: rotate(0); } 50% { transform: rotate(10deg); } }
        @keyframes op-blink { 0%,92%,100% { transform: scaleY(1); } 95% { transform: scaleY(.1); } }
        @keyframes op-spark { 0% { opacity: 1; } 100% { opacity: 0; } }
        @keyframes op-pant { from { transform: scaleY(1); } to { transform: scaleY(1.25); } }
        @media (prefers-reduced-motion: reduce) { .op-tail,.op-head,.op-ear-l,.op-ear-r,.op-eye,.op-spark,.op-spark2,.op-tongue { animation: none; } }
      `}</style>
      <svg viewBox="0 0 220 160" width="100%" role="img">
        {/* floor */}
        <ellipse cx="118" cy="142" rx="70" ry="7" fill="#E9E5F5" />
        {/* wall socket + sparks */}
        <rect x="6" y="70" width="26" height="34" rx="5" fill="#fff" stroke="#CBD5E1" strokeWidth="2" />
        <rect x="13" y="80" width="3" height="8" rx="1.5" fill="#94A3B8" />
        <rect x="22" y="80" width="3" height="8" rx="1.5" fill="#94A3B8" />
        <circle cx="19" cy="95" r="2" fill="#94A3B8" />
        <path className="op-spark" d="M36 76 l8 -4 -3 6 9 -3" stroke="#F5B301" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path className="op-spark2" d="M36 96 l9 3 -6 2 8 5" stroke="#F97316" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {/* the wire, from the socket to the puppy's mouth */}
        <path d="M30 90 C 50 132, 70 128, 84 104" stroke="#334155" strokeWidth="3" fill="none" strokeLinecap="round" />
        {/* tail */}
        <g className="op-tail">
          <path d="M150 98 C 166 90, 170 74, 164 64" stroke="#B9763C" strokeWidth="9" fill="none" strokeLinecap="round" />
        </g>
        {/* body + legs */}
        <ellipse cx="126" cy="112" rx="34" ry="24" fill="#D39457" />
        <ellipse cx="128" cy="118" rx="18" ry="13" fill="#F3D5B0" />
        <rect x="100" y="122" width="12" height="20" rx="6" fill="#C9874A" />
        <rect x="140" y="122" width="12" height="20" rx="6" fill="#C9874A" />
        <ellipse cx="106" cy="141" rx="9" ry="4" fill="#B9763C" />
        <ellipse cx="146" cy="141" rx="9" ry="4" fill="#B9763C" />
        {/* head */}
        <g className="op-head">
          <g className="op-ear-l"><ellipse cx="70" cy="76" rx="10" ry="20" fill="#8B5A2B" transform="rotate(18 70 76)" /></g>
          <g className="op-ear-r"><ellipse cx="114" cy="76" rx="10" ry="20" fill="#8B5A2B" transform="rotate(-18 114 76)" /></g>
          <circle cx="92" cy="80" r="26" fill="#D39457" />
          <ellipse cx="92" cy="92" rx="15" ry="11" fill="#F3D5B0" />
          {/* eye patch */}
          <ellipse cx="102" cy="74" rx="8" ry="9" fill="#B9763C" />
          <ellipse className="op-eye" cx="83" cy="75" rx="3.4" ry="4.2" fill="#1F2937" />
          <ellipse className="op-eye" cx="102" cy="75" rx="3.4" ry="4.2" fill="#1F2937" />
          <circle cx="84.2" cy="73.6" r="1.1" fill="#fff" />
          <circle cx="103.2" cy="73.6" r="1.1" fill="#fff" />
          {/* nose + mouth */}
          <ellipse cx="92" cy="86" rx="5" ry="3.6" fill="#1F2937" />
          <path d="M92 89 v3 M86 93 q6 4 12 0" stroke="#7C4A21" strokeWidth="1.6" fill="none" strokeLinecap="round" />
          <path className="op-tongue" d="M95 95 q3 8 7 2" fill="#F472B6" />
          {/* the plug, held in its mouth */}
          <rect x="78" y="96" width="12" height="9" rx="2" fill="#475569" />
          <rect x="74" y="98" width="5" height="1.8" rx=".9" fill="#CBD5E1" />
          <rect x="74" y="101.6" width="5" height="1.8" rx=".9" fill="#CBD5E1" />
        </g>
      </svg>
    </div>
  );
}
