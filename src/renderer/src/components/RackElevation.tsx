/**
 * Podgląd elewacji szafy 19" (widok od frontu) — lekki SVG, bez renderera CAD.
 * Zajęte U rysujemy od dołu (uPos=1 na dole), z numeracją i etykietami.
 */

interface RackUnitView {
  uPos: number
  uSize: number
  label: string
}
interface RackView {
  id: string
  name: string
  uHeight: number
  units: RackUnitView[]
}

const UH = 13 // wysokość 1U [px]
const W = 200 // szerokość pola montażowego [px]
const PADX = 26 // miejsce na numerację U

export function RackElevation({ rack }: { rack: RackView }): JSX.Element {
  const H = rack.uHeight * UH
  const yOf = (uPos: number) => (rack.uHeight - uPos + 1) * UH // uPos=1 na dole

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-medium text-slate-200">{rack.name}</span>
        <span className="text-slate-400">{rack.units.length} poz. / {rack.uHeight}U</span>
      </div>
      <svg width={PADX + W + 4} height={H + 4} className="rounded bg-black/30">
        <g transform="translate(1,2)">
          {/* siatka U + numeracja */}
          {Array.from({ length: rack.uHeight }, (_, i) => {
            const u = rack.uHeight - i
            const y = i * UH
            return (
              <g key={u}>
                <line x1={PADX} y1={y} x2={PADX + W} y2={y} stroke="#1e293b" strokeWidth={0.5} />
                <text x={PADX - 4} y={y + UH - 3} textAnchor="end" fontSize={7} fill="#475569">{u}</text>
              </g>
            )
          })}
          {/* obrys + szyny */}
          <rect x={PADX} y={0} width={W} height={H} fill="none" stroke="#334155" strokeWidth={1} />
          {/* zajęte U */}
          {rack.units.map((un, idx) => {
            const top = yOf(un.uPos + un.uSize - 1)
            const h = un.uSize * UH
            const active = /switch|os6560|os6900|os6360/i.test(un.label)
            return (
              <g key={idx}>
                <rect
                  x={PADX + 2}
                  y={top}
                  width={W - 4}
                  height={h - 1}
                  rx={1.5}
                  fill={active ? '#0ea5e933' : '#10b98122'}
                  stroke={active ? '#38bdf8' : '#34d399'}
                  strokeWidth={0.8}
                />
                <text x={PADX + 8} y={top + h - 3} fontSize={7.5} fill="#cbd5e1">
                  {un.label.length > 34 ? un.label.slice(0, 33) + '…' : un.label}
                </text>
              </g>
            )
          })}
        </g>
      </svg>
    </div>
  )
}
