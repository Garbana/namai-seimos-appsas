import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { eur } from './api'

export type LinijuSerija = {
  key: string
  name: string
  /** Spalva arba CSS kintamasis (pvz. var(--tekstas) bendrai sumai). */
  color: string
  points: (number | null)[]
  storas?: boolean
}

type Props = {
  serijos: LinijuSerija[]
  /** Kiekvieno taško pavadinimas patarime (pvz. „liepa 2026"). */
  pavadinimai: string[]
  /** Ašies žymos pagal taško indeksą; per tankios praretinamos. */
  zymos: { i: number; tekstas: string }[]
  ariaLabel: string
}

const AUKSTIS = 240
const PARASTES = { kaire: 60, desine: 18, virsus: 12, apacia: 28 }
const MIN_TARPAS_TARP_ZYMIU = 56

/** Tvarkingas ašies žingsnis centais: 1, 2, 2,5 arba 5 × 10ⁿ eurų, apie 4 žymos. */
function asiesZingsnis(intervalasCents: number) {
  const eurai = Math.max(intervalasCents / 100 / 4, 1)
  const laipsnis = 10 ** Math.floor(Math.log10(eurai))
  const zingsnis = [1, 2, 2.5, 5, 10].map((k) => k * laipsnis).find((k) => k >= eurai) ?? 10 * laipsnis
  return zingsnis * 100
}

function asiesEurai(cents: number) {
  const eurai = Math.abs(cents) / 100
  const tekstas = eurai >= 10_000 ? `${Math.round(eurai / 1000)} k €` : `${Math.round(eurai).toLocaleString('lt-LT')} €`
  return cents < 0 ? `−${tekstas}` : tekstas
}

/**
 * Kelios linijos laike su vienu y ašies masteliu. Užvedus pelę (ar rodyklėmis
 * klaviatūra) rodomos visų linijų to taško reikšmės. Tušti taškai (null) nutraukia liniją.
 */
export default function LinijuGrafikas({ serijos, pavadinimai, zymos, ariaLabel }: Props) {
  const dezute = useRef<HTMLDivElement>(null)
  const [plotis, setPlotis] = useState(720)
  const [aktyvus, setAktyvus] = useState<number | null>(null)
  const n = pavadinimai.length

  useEffect(() => {
    const el = dezute.current
    if (!el) return
    const stebetojas = new ResizeObserver(([irasas]) => setPlotis(Math.max(280, Math.floor(irasas.contentRect.width))))
    stebetojas.observe(el)
    return () => stebetojas.disconnect()
  }, [])

  const g = useMemo(() => {
    const visos = serijos.flatMap((s) => s.points.filter((p): p is number => p !== null))
    if (n < 2 || visos.length === 0) return null

    const min = Math.min(0, ...visos)
    const max = Math.max(1, ...visos)
    const zingsnis = asiesZingsnis(max - min)
    const apacia = Math.floor(min / zingsnis) * zingsnis
    const virsus = Math.ceil(max / zingsnis) * zingsnis
    const vidPlotis = plotis - PARASTES.kaire - PARASTES.desine
    const vidAukstis = AUKSTIS - PARASTES.virsus - PARASTES.apacia

    const x = (i: number) => PARASTES.kaire + (i / (n - 1)) * vidPlotis
    const y = (cents: number) => PARASTES.virsus + (1 - (cents - apacia) / (virsus - apacia)) * vidAukstis

    const linijos = serijos.map((s) => {
      let d = ''
      const vienisiTaskai: number[] = []
      s.points.forEach((p, i) => {
        if (p === null) return
        const pries = i > 0 ? s.points[i - 1] : null
        const po = i < n - 1 ? s.points[i + 1] : null
        d += `${pries === null ? 'M' : 'L'}${x(i).toFixed(1)},${y(p).toFixed(1)}`
        if (pries === null && po === null) vienisiTaskai.push(i)
      })
      return { d, vienisiTaskai }
    })

    const yZymos: number[] = []
    for (let v = apacia; v <= virsus; v += zingsnis) yZymos.push(v)

    const tarpas = zymos.length > 1 ? Math.abs(x(zymos[1].i) - x(zymos[0].i)) : Infinity
    const kas = Math.max(1, Math.ceil(MIN_TARPAS_TARP_ZYMIU / Math.max(1, tarpas)))
    const xZymos = zymos.filter((_, k) => k % kas === 0).map((z) => ({ ...z, x: x(z.i) }))

    return { x, y, linijos, yZymos, xZymos, nulis: y(0) }
  }, [serijos, n, zymos, plotis])

  function judant(e: PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const santykis = (e.clientX - rect.left - PARASTES.kaire) / (plotis - PARASTES.kaire - PARASTES.desine)
    setAktyvus(Math.min(n - 1, Math.max(0, Math.round(santykis * (n - 1)))))
  }

  function klaviatura(e: KeyboardEvent<SVGSVGElement>) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const zingsnis = e.key === 'ArrowRight' ? 1 : -1
    setAktyvus((dabar) => Math.min(n - 1, Math.max(0, (dabar ?? n - 1) + zingsnis)))
  }

  const taskoX = aktyvus !== null && g ? g.x(aktyvus) : 0
  const patarimas =
    aktyvus === null
      ? []
      : serijos
          .map((s) => ({ s, v: s.points[aktyvus] }))
          .filter((x): x is { s: LinijuSerija; v: number } => x.v !== null && x.v !== undefined)
          .sort((a, b) => b.v - a.v)

  return (
    <div className="likucio-grafikas linijos-grafikas" ref={dezute}>
      {!g && <p className="tuscia">Šiam laikotarpiui duomenų nėra.</p>}
      {g && (
        <svg
          width={plotis}
          height={AUKSTIS}
          role="img"
          aria-label={ariaLabel}
          tabIndex={0}
          onPointerMove={judant}
          onPointerLeave={() => setAktyvus(null)}
          onKeyDown={klaviatura}
          onBlur={() => setAktyvus(null)}
        >
          {g.yZymos.map((v) => (
            <g key={v}>
              <line
                x1={PARASTES.kaire}
                x2={plotis - PARASTES.desine}
                y1={g.y(v)}
                y2={g.y(v)}
                className={v === 0 ? 'tinklelis nulis' : 'tinklelis'}
              />
              <text x={PARASTES.kaire - 8} y={g.y(v)} className="asis" textAnchor="end" dominantBaseline="middle">
                {asiesEurai(v)}
              </text>
            </g>
          ))}
          {g.xZymos.map((z) => (
            <text key={`${z.i}-${z.tekstas}`} x={z.x} y={AUKSTIS - 8} className="asis" textAnchor="middle">
              {z.tekstas}
            </text>
          ))}

          {serijos.map((s, k) => (
            <g key={s.key}>
              <path d={g.linijos[k].d} className="linija-serija" style={{ stroke: s.color, strokeWidth: s.storas ? 2.5 : 2 }} />
              {g.linijos[k].vienisiTaskai.map((i) => (
                <circle key={i} cx={g.x(i)} cy={g.y(s.points[i] ?? 0)} r={3} style={{ fill: s.color }} />
              ))}
            </g>
          ))}

          {aktyvus !== null && (
            <>
              <line x1={taskoX} x2={taskoX} y1={PARASTES.virsus} y2={AUKSTIS - PARASTES.apacia} className="kryzius" />
              {patarimas.map(({ s, v }) => (
                <circle key={s.key} cx={taskoX} cy={g.y(v)} r={4} className="taskas-serija" style={{ fill: s.color }} />
              ))}
            </>
          )}
        </svg>
      )}

      {g && aktyvus !== null && (
        <div
          className="grafiko-patarimas"
          style={{ left: Math.min(plotis - 130, Math.max(130, taskoX)) }}
          role="status"
        >
          <span>{pavadinimai[aktyvus]}</span>
          <ul>
            {patarimas.map(({ s, v }) => (
              <li key={s.key}>
                <span className="spalvos-zyme" style={{ background: s.color }} />
                <span>{s.name}</span>
                <span className="num">{eur(v)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
