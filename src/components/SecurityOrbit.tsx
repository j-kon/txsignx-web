export function SecurityOrbit(){
  return (
    <div className="security-orbit-container" aria-hidden="true">
      <div className="orbit-ambient-glow" />
      <svg
        className="security-orbit-svg"
        viewBox="0 0 520 520"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Radial glow for center core */}
          <radialGradient id="core-glow-grad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#1E4B8F" stopOpacity="0.45" />
            <stop offset="60%" stopColor="#1E4B8F" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#1E4B8F" stopOpacity="0" />
          </radialGradient>

          {/* Sweep gradient */}
          <linearGradient id="sweep-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0" />
            <stop offset="45%" stopColor="#FFFFFF" stopOpacity="0" />
            <stop offset="50%" stopColor="#FFFFFF" stopOpacity="0.35" />
            <stop offset="55%" stopColor="#F7931A" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          </linearGradient>

          {/* Filter for glowing nodes */}
          <filter id="node-glow-blue" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          <filter id="node-glow-orange" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Ambient background aura */}
        <circle cx="260" cy="260" r="140" fill="url(#core-glow-grad)" className="ambient-core-pulse" />

        {/* Inbound Transaction Signal Conduits */}
        <g className="signal-conduits" opacity="0.4">
          <line x1="40" y1="260" x2="210" y2="260" stroke="#243041" strokeWidth="1" strokeDasharray="4 6" />
          <line x1="260" y1="40" x2="260" y2="210" stroke="#243041" strokeWidth="1" strokeDasharray="4 6" />
          <line x1="480" y1="260" x2="310" y2="260" stroke="#243041" strokeWidth="1" strokeDasharray="4 6" />
          <line x1="260" y1="480" x2="260" y2="310" stroke="#243041" strokeWidth="1" strokeDasharray="4 6" />
        </g>

        {/* Orbit Ring 1 (Inner) */}
        <g className="orbit-group-1">
          <circle cx="260" cy="260" r="105" stroke="#243041" strokeWidth="1.2" strokeDasharray="6 4" opacity="0.6" />
          <circle cx="260" cy="155" r="4" fill="#3B82F6" filter="url(#node-glow-blue)" className="orbit-node node-blue" />
        </g>

        {/* Orbit Ring 2 (Middle) */}
        <g className="orbit-group-2">
          <circle cx="260" cy="260" r="165" stroke="#1E4B8F" strokeWidth="1" strokeOpacity="0.4" />
          <circle cx="425" cy="260" r="4.5" fill="#F7931A" filter="url(#node-glow-orange)" className="orbit-node node-orange" />
          <circle cx="95" cy="260" r="3" fill="#E2E8F0" opacity="0.85" className="orbit-node node-white" />
        </g>

        {/* Orbit Ring 3 (Outer) */}
        <g className="orbit-group-3">
          <circle cx="260" cy="260" r="225" stroke="#243041" strokeWidth="1.2" strokeDasharray="3 7" opacity="0.5" />
          <circle cx="260" cy="485" r="4" fill="#38BDF8" filter="url(#node-glow-blue)" className="orbit-node node-cyan" />
          <circle cx="101" cy="101" r="3.5" fill="#FBBF24" filter="url(#node-glow-orange)" className="orbit-node node-amber" />
        </g>

        {/* Center Security Core (Hexagonal Badge + X) */}
        <g className="security-core-group">
          {/* Outer Shield Hexagon */}
          <polygon
            points="260,205 308,232.5 308,287.5 260,315 212,287.5 212,232.5"
            fill="#111827"
            stroke="#243041"
            strokeWidth="2"
            className="core-outer-hex"
          />

          {/* Inner Accent Hexagon */}
          <polygon
            points="260,214 299,236.5 299,283.5 260,306 221,283.5 221,236.5"
            fill="#0B0F14"
            stroke="#1E4B8F"
            strokeWidth="1.5"
            strokeOpacity="0.8"
            className="core-inner-hex"
          />

          {/* Center X Logo Crosshair */}
          <path
            d="M245 245L275 275M275 245L245 275"
            stroke="#F7931A"
            strokeWidth="3.5"
            strokeLinecap="round"
            className="core-x"
          />

          {/* Verification Shield Center Indicator */}
          <circle cx="260" cy="260" r="2.5" fill="#FFFFFF" opacity="0.9" />

          {/* Light Sweep Across Shield */}
          <polygon
            points="260,205 308,232.5 308,287.5 260,315 212,287.5 212,232.5"
            fill="url(#sweep-grad)"
            className="core-light-sweep"
          />
        </g>

        {/* Directional verification telemetry markers */}
        <text x="260" y="338" textAnchor="middle" fill="#64748B" fontSize="9" fontFamily="monospace" letterSpacing="0.1em">
          PRE-SIGN BOUNDARY
        </text>
      </svg>
    </div>
  )
}
