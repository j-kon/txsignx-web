import {useRef} from 'react'

export function SecurityOrbit(){
  const containerRef = useRef<HTMLDivElement>(null)

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>){
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width - 0.5) * 10
    const y = ((e.clientY - rect.top) / rect.height - 0.5) * 10
    el.style.setProperty('--tilt-x', `${-y}deg`)
    el.style.setProperty('--tilt-y', `${x}deg`)
  }

  function handleMouseLeave(){
    const el = containerRef.current
    if (!el) return
    el.style.setProperty('--tilt-x', '0deg')
    el.style.setProperty('--tilt-y', '0deg')
  }

  return (
    <div
      ref={containerRef}
      className="security-orbit-container"
      aria-hidden="true"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
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
            <stop offset="0%" stopColor="#1E4B8F" stopOpacity="0.55" />
            <stop offset="50%" stopColor="#1E4B8F" stopOpacity="0.2" />
            <stop offset="85%" stopColor="#F7931A" stopOpacity="0.04" />
            <stop offset="100%" stopColor="#1E4B8F" stopOpacity="0" />
          </radialGradient>

          {/* Light sweep gradient across core */}
          <linearGradient id="sweep-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0" />
            <stop offset="42%" stopColor="#FFFFFF" stopOpacity="0" />
            <stop offset="50%" stopColor="#FFFFFF" stopOpacity="0.4" />
            <stop offset="56%" stopColor="#F7931A" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          </linearGradient>

          {/* Filter for glowing nodes */}
          <filter id="node-glow-blue" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          <filter id="node-glow-orange" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="3.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Ambient background aura behind enlarged core */}
        <circle cx="260" cy="260" r="165" fill="url(#core-glow-grad)" className="ambient-core-pulse" />

        {/* Inbound & Outbound Data Flow Conduits */}
        <g className="data-flow-conduits">
          {/* Inbound line: Wallet Context -> Core */}
          <line x1="55" y1="260" x2="195" y2="260" stroke="#1E4B8F" strokeWidth="1.5" strokeDasharray="4 6" opacity="0.75" />
          {/* Outbound line: Core -> Signing Boundary */}
          <line x1="325" y1="260" x2="465" y2="260" stroke="#F7931A" strokeWidth="1.5" strokeDasharray="4 6" opacity="0.75" />
          {/* Cross-axis subtle alignment axes */}
          <line x1="260" y1="45" x2="260" y2="185" stroke="#243041" strokeWidth="1" strokeDasharray="3 7" opacity="0.4" />
          <line x1="260" y1="335" x2="260" y2="475" stroke="#243041" strokeWidth="1" strokeDasharray="3 7" opacity="0.4" />
        </g>

        {/* Moving Transaction Data Pulses */}
        <g className="flow-pulses">
          {/* Pulse 1: Inbound transaction arriving from wallet context */}
          <circle cx="55" cy="260" r="3.5" fill="#3B82F6" filter="url(#node-glow-blue)" className="flow-pulse-inbound" />
          {/* Pulse 2: Outbound vetted decision moving to signing boundary */}
          <circle cx="325" cy="260" r="3.5" fill="#F7931A" filter="url(#node-glow-orange)" className="flow-pulse-outbound" />
        </g>

        {/* Source and Destination Boundary Nodes */}
        <g className="flow-boundary-nodes">
          {/* Source node: Wallet Context */}
          <circle cx="55" cy="260" r="5" fill="#111827" stroke="#3B82F6" strokeWidth="2" />
          <circle cx="55" cy="260" r="2" fill="#3B82F6" />
          <text x="55" y="278" textAnchor="middle" fill="#64748B" fontSize="8" fontFamily="monospace" letterSpacing="0.08em">
            WALLET
          </text>

          {/* Destination node: Pre-Sign / Signer Egress */}
          <circle cx="465" cy="260" r="5" fill="#111827" stroke="#F7931A" strokeWidth="2" />
          <circle cx="465" cy="260" r="2" fill="#F7931A" />
          <text x="465" y="278" textAnchor="middle" fill="#64748B" fontSize="8" fontFamily="monospace" letterSpacing="0.08em">
            SIGNER
          </text>
        </g>

        {/* Orbit Ring 1 (Inner) - Radius 125 */}
        <g className="orbit-group-1">
          <circle cx="260" cy="260" r="125" stroke="#243041" strokeWidth="1.2" strokeDasharray="6 5" opacity="0.65" />
          <circle cx="260" cy="135" r="4" fill="#3B82F6" filter="url(#node-glow-blue)" className="orbit-node node-blue" />
        </g>

        {/* Orbit Ring 2 (Middle) - Radius 175 */}
        <g className="orbit-group-2">
          <circle cx="260" cy="260" r="175" stroke="#1E4B8F" strokeWidth="1.2" strokeOpacity="0.5" />
          <circle cx="435" cy="260" r="4.5" fill="#F7931A" filter="url(#node-glow-orange)" className="orbit-node node-orange" />
          <circle cx="85" cy="260" r="3.5" fill="#E2E8F0" opacity="0.85" className="orbit-node node-white" />
        </g>

        {/* Orbit Ring 3 (Outer) - Radius 225 */}
        <g className="orbit-group-3">
          <circle cx="260" cy="260" r="225" stroke="#243041" strokeWidth="1.2" strokeDasharray="3 7" opacity="0.5" />
          <circle cx="260" cy="485" r="4" fill="#38BDF8" filter="url(#node-glow-blue)" className="orbit-node node-cyan" />
          <circle cx="101" cy="101" r="3.5" fill="#FBBF24" filter="url(#node-glow-orange)" className="orbit-node node-amber" />
        </g>

        {/* Enlarged Center Security Core (Hexagonal Shield + X Logo ~35% larger) */}
        <g className="security-core-group">
          {/* Outer Shield Hexagon - Radius 75 */}
          <polygon
            points="260,185 325,222.5 325,297.5 260,335 195,297.5 195,222.5"
            fill="#111827"
            stroke="#243041"
            strokeWidth="2.5"
            className="core-outer-hex"
          />

          {/* Inner Accent Hexagon - Radius 64 */}
          <polygon
            points="260,196 315,228 315,292 260,324 205,292 205,228"
            fill="#0B0F14"
            stroke="#1E4B8F"
            strokeWidth="2"
            strokeOpacity="0.9"
            className="core-inner-hex"
          />

          {/* Hexagonal Corner Tech Accents */}
          <circle cx="260" cy="196" r="2" fill="#F7931A" opacity="0.8" />
          <circle cx="260" cy="324" r="2" fill="#3B82F6" opacity="0.8" />

          {/* Center X Logo Crosshair */}
          <path
            d="M240 240L280 280M280 240L240 280"
            stroke="#F7931A"
            strokeWidth="4.5"
            strokeLinecap="round"
            className="core-x"
          />

          {/* Central Target Pivot */}
          <circle cx="260" cy="260" r="3" fill="#FFFFFF" opacity="0.95" />

          {/* Light Sweep Across Core Shield */}
          <polygon
            points="260,185 325,222.5 325,297.5 260,335 195,297.5 195,222.5"
            fill="url(#sweep-grad)"
            className="core-light-sweep"
          />
        </g>

        {/* Directional verification telemetry marker */}
        <text
          x="260"
          y="358"
          textAnchor="middle"
          fill="#64748B"
          fontSize="9.5"
          fontFamily="monospace"
          letterSpacing="0.12em"
        >
          PRE-SIGN BOUNDARY
        </text>
      </svg>
    </div>
  )
}
