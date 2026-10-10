import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { eur, menuoVardas } from './api'

export type PensijuSerija = { code: string; name: string; points: (number | null)[] }

/**
 * Fiksuota spalvų eilė (dataviz paletė, patikrinta validatoriumi). Spalva seka
 * produktą pagal jo vietą sąraše, niekada ne pagal dydį.
 */
export const SERIJU_SPALVOS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4']

type Props = { menesiai: string[]; serijos: PensijuSerija[] }

const AUKSTIS = 260
const PARASTES = { kaire: 60, desine: 18, virsus: 14, apacia: 28 }

/** Tvarkingas ašies žingsnis centais: 1, 2, 2,5 arba 5 × 10ⁿ eurų, apie 4 žymos. */
function asiesZingsnis(maxCents: number) {
  const eurai = Math.max(maxCents / 100 / 4, 1)
  const laipsnis = 10 ** Math.floor(Math.log10(eurai))
  const zingsnis = [1, 2, 2.5, 5, 10].map((k) => k * laipsnis).find((k) => k >= eurai) ?? 10 * laipsnis
  return zingsnis * 100
}

function asiesEurai(cents: number) {
  const eurai = cents / 100
  return eurai >= 10_000 ? `${Math.round(eurai / 1000)} k €` : `${Math.round(eurai).toLocaleString('lt-LT')} €`
}

/**
 * Sukaupta suma laike, sukrauta pagal produktus. Užvedus pelę (ar rodyklėmis
 * klaviatūra) rodomos to mėnesio vertės; tos pačios sumos yra ir lentelėje po grafiku.
 */
export default function PensijuGrafikas({ menesiai, serijos }: Props) {
  const dezute = useRef<HTMLDivElement>(null)
  const [plotis, setPlotis] = useState(720)
  const [aktyvus, setAktyvus] = useState<number | null>(null)

  useEffect(() => {
    const el = dezute.current
    if (!el) return
    const stebetojas = new ResizeObserver(([irasas]) => setPlotis(Math.max(280, Math.floor(irasas.contentRect.width))))
    stebetojas.observe(el)
    return () => stebetojas.disconnect()
  }, [])

  const g = useMemo(() => {
    if (menesiai.length < 2 || serijos.length === 0) return null

    // sukaupta[i][k] — k-osios juostos viršus i-tąjį mėnesį.
    const sukaupta = menesiai.map((_, i) => {
      let s = 0
      return serijos.map((serija) => (s += serija.points[i] ?? 0))
    })
    const max = Math.max(...sukaupta.map((r) => r[r.length - 1]))
    const zingsnis = asiesZingsnis(max)
    const asiesVirsus = Math.ceil(max / zingsnis) * zingsnis
    const vidPlotis = plotis - PARASTES.kaire - PARASTES.desine
    const vidAukstis = AUKSTIS - PARASTES.virsus - PARASTES.apacia

    const x = (i: number) => PARASTES.kaire + (i / (menesiai.length - 1)) * vidPlotis
    const y = (cents: number) => PARASTES.virsus + (1 - cents / asiesVirsus) * vidAukstis

    const juostos = serijos.map((_, k) => {
      const virsutine = menesiai.map((_, i) => `${x(i).toFixed(1)},${y(sukaupta[i][k]).toFixed(1)}`)
      const apatine = menesiai
        .map((_, i) => `${x(i).toFixed(1)},${y(k > 0 ? sukaupta[i][k - 1] : 0).toFixed(1)}`)
        .reverse()
      return { plotas: `M${virsutine.join('L')}L${apatine.join('L')}Z`, riba: `M${virsutine.join('L')}` }
    })

    const yZymos: number[] = []
    for (let v = 0; v <= asiesVirsus; v += zingsnis) yZymos.push(v)

    const metuPradzios = menesiai.flatMap((m, i) => (m.endsWith('-01') ? [{ metai: m.slice(0, 4), x: x(i) }] : []))
    const kas = Math.max(1, Math.ceil(metuPradzios.length / Math.max(2, Math.floor(vidPlotis / 56))))
    const xZymos = metuPradzios.filter((_, i) => i % kas === 0)

    return { x, y, juostos, yZymos, xZymos, sukaupta, nulis: y(0) }
  }, [menesiai, serijos, plotis])

  function judant(e: PointerEvent<SVGSVGElement>) {
    if (!g) return
    const rect = e.currentTarget.getBoundingClientRect()
    const santykis = (e.clientX - rect.left - PARASTES.kaire) / (plotis - PARASTES.kaire - PARASTES.desine)
    setAktyvus(Math.min(menesiai.length - 1, Math.max(0, Math.round(santykis * (menesiai.length - 1)))))
  }

  function klaviatura(e: KeyboardEvent<SVGSVGElement>) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const zingsnis = e.key === 'ArrowRight' ? 1 : -1
    setAktyvus((dabar) => Math.min(menesiai.length - 1, Math.max(0, (dabar ?? menesiai.length - 1) + zingsnis)))
  }

  const taskoX = aktyvus !== null && g ? g.x(aktyvus) : 0

  return (
    <div className="likucio-grafikas pensiju-grafikas" ref={dezute}>
      <ul className="grafiko-legenda">
        {serijos.map((s, k) => (
          <li key={s.code}>
            <span className="spalvos-zyme" style={{ background: SERIJU_SPALVOS[k] }} />
            {s.name}
          </li>
        ))}
      </ul>

      {g && (
        <svg
          width={plotis}
          height={AUKSTIS}
          role="img"
          aria-label="Sukaupta pensijai suma pagal mėnesius ir produktus. Visos sumos — lentelėje po grafiku."
          tabIndex={0}
          onPointerMove={judant}
          onPointerLeave={() => setAktyvus(null)}
          onKeyDown={klaviatura}
          onBlur={() => setAktyvus(null)}
        >
          {g.yZymos.map((v) => (
            <g key={v}>
              <line x1={PARASTES.kaire} x2={plotis - PARASTES.desine} y1={g.y(v)} y2={g.y(v)} className="tinklelis" />
              <text x={PARASTES.kaire - 8} y={g.y(v)} className="asis" textAnchor="end" dominantBaseline="middle">
                {asiesEurai(v)}
              </text>
            </g>
          ))}
          {g.xZymos.map((z) => (
            <text key={z.metai} x={z.x} y={AUKSTIS - 8} className="asis" textAnchor="middle">
              {z.metai}
            </text>
          ))}

          {g.juostos.map((j, k) => (
            <path key={serijos[k].code} d={j.plotas} fill={SERIJU_SPALVOS[k]} className="juosta" />
          ))}
          {/* 2 px paviršiaus tarpas tarp juostų. */}
          {g.juostos.slice(0, -1).map((j, k) => (
            <path key={serijos[k].code} d={j.riba} className="juostu-tarpas" />
          ))}

          {aktyvus !== null && (
            <line x1={taskoX} x2={taskoX} y1={PARASTES.virsus} y2={g.nulis} className="kryzius" />
          )}
        </svg>
      )}

      {g && aktyvus !== null && (
        <div className="grafiko-patarimas" style={{ left: Math.min(plotis - 130, Math.max(130, taskoX)) }} role="status">
          <span>{menuoVardas(menesiai[aktyvus])}</span>
          <strong>{eur(g.sukaupta[aktyvus][serijos.length - 1])}</strong>
          <ul>
            {serijos
              .map((s, k) => ({ s, k }))
              .reverse()
              .map(({ s, k }) => (
                <li key={s.code}>
                  <span className="spalvos-zyme" style={{ background: SERIJU_SPALVOS[k] }} />
                  <span>{s.name}</span>
                  <span className="num">{s.points[aktyvus] === null ? '—' : eur(s.points[aktyvus] ?? 0)}</span>
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  )
}
