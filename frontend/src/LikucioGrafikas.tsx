import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { eur, type KreditoGrafikoTaskas } from './api'

type Props = {
  taskai: KreditoGrafikoTaskas[]
  siandien: string
  dabartinisLikutis: number
}

const AUKSTIS = 220
const PARASTES = { kaire: 60, desine: 18, virsus: 26, apacia: 28 }

const laikas = (data: string) => Date.parse(`${data}T00:00:00Z`)

/** Tvarkingas ašies žingsnis centais: 1, 2, 2,5 arba 5 × 10ⁿ eurų, apie 4 žymos. */
function asiesZingsnis(maxCents: number) {
  const eurai = Math.max(maxCents / 100 / 4, 1)
  const laipsnis = 10 ** Math.floor(Math.log10(eurai))
  const zingsnis = [1, 2, 2.5, 5, 10].map((k) => k * laipsnis).find((k) => k >= eurai) ?? 10 * laipsnis
  return zingsnis * 100
}

function asiesEurai(cents: number) {
  const eurai = cents / 100
  return eurai >= 10_000
    ? `${Math.round(eurai / 1000)} k €`
    : `${Math.round(eurai).toLocaleString('lt-LT')} €`
}

/**
 * Kredito likutis laike pagal grafiką. Ištisinė linija — jau praėję mokėjimai,
 * punktyrinė — ateities planas. Užvedus pelę (ar rodyklėmis klaviatūra) rodoma
 * artimiausio mokėjimo informacija; tas pats yra ir grafiko lentelėje.
 */
export default function LikucioGrafikas({ taskai, siandien, dabartinisLikutis }: Props) {
  const dezute = useRef<HTMLDivElement>(null)
  const [plotis, setPlotis] = useState(720)
  const [aktyvus, setAktyvus] = useState<number | null>(null)

  useEffect(() => {
    const el = dezute.current
    if (!el) return
    const stebetojas = new ResizeObserver(([irasas]) =>
      setPlotis(Math.max(280, Math.floor(irasas.contentRect.width)))
    )
    stebetojas.observe(el)
    return () => stebetojas.disconnect()
  }, [])

  const g = useMemo(() => {
    if (taskai.length < 2) return null

    const pradzia = laikas(taskai[0].date)
    const pabaiga = laikas(taskai[taskai.length - 1].date)
    const max = Math.max(...taskai.map((t) => t.balance))
    const zingsnis = asiesZingsnis(max)
    const virsus = Math.ceil(max / zingsnis) * zingsnis
    const vidPlotis = plotis - PARASTES.kaire - PARASTES.desine
    const vidAukstis = AUKSTIS - PARASTES.virsus - PARASTES.apacia

    const x = (data: string) =>
      PARASTES.kaire + ((laikas(data) - pradzia) / Math.max(1, pabaiga - pradzia)) * vidPlotis
    const y = (cents: number) => PARASTES.virsus + (1 - cents / virsus) * vidAukstis

    const yZymos: number[] = []
    for (let v = 0; v <= virsus; v += zingsnis) yZymos.push(v)

    const pirmiMetai = Number(taskai[0].date.slice(0, 4))
    const paskutiniaiMetai = Number(taskai[taskai.length - 1].date.slice(0, 4))
    const kas = Math.max(1, Math.ceil((paskutiniaiMetai - pirmiMetai) / Math.max(2, Math.floor(vidPlotis / 64))))
    const xZymos: { metai: number; x: number }[] = []
    for (let m = pirmiMetai + 1; m <= paskutiniaiMetai; m++) {
      if ((m - pirmiMetai - 1) % kas === 0) xZymos.push({ metai: m, x: x(`${m}-01-01`) })
    }

    const kelias = (tt: KreditoGrafikoTaskas[]) =>
      tt.map((t, i) => `${i ? 'L' : 'M'}${x(t.date).toFixed(1)},${y(t.balance).toFixed(1)}`).join('')

    const riba = taskai.findIndex((t) => t.date > siandien)
    const praeitis = riba === -1 ? taskai : taskai.slice(0, Math.max(1, riba))
    const ateitis = riba === -1 ? [] : taskai.slice(Math.max(0, riba - 1))
    const paskutinis = taskai[taskai.length - 1]
    const nulis = y(0)

    const s = laikas(siandien)
    return {
      x,
      y,
      nulis,
      yZymos,
      xZymos,
      praeitis: praeitis.length > 1 ? kelias(praeitis) : null,
      ateitis: ateitis.length > 1 ? kelias(ateitis) : null,
      plotas: `${kelias(taskai)}L${x(paskutinis.date).toFixed(1)},${nulis}L${x(taskai[0].date).toFixed(1)},${nulis}Z`,
      siandienX: s >= pradzia && s <= pabaiga ? x(siandien) : null,
    }
  }, [taskai, plotis, siandien])

  function artimiausias(px: number) {
    if (!g) return null
    let geriausias = 0
    let atstumas = Infinity
    taskai.forEach((t, i) => {
      const d = Math.abs(g.x(t.date) - px)
      if (d < atstumas) {
        atstumas = d
        geriausias = i
      }
    })
    return geriausias
  }

  function judant(e: PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    setAktyvus(artimiausias(e.clientX - rect.left))
  }

  function klaviatura(e: KeyboardEvent<SVGSVGElement>) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const zingsnis = e.key === 'ArrowRight' ? 1 : -1
    setAktyvus((dabar) => Math.min(taskai.length - 1, Math.max(0, (dabar ?? 0) + zingsnis)))
  }

  const taskas = aktyvus !== null ? taskai[aktyvus] : null
  const taskoX = taskas && g ? g.x(taskas.date) : 0
  const siandienDesineje = g?.siandienX != null && g.siandienX > plotis * 0.6

  return (
    <div className="likucio-grafikas" ref={dezute}>
      {g && (
        <svg
          width={plotis}
          height={AUKSTIS}
          role="img"
          aria-label="Kredito likutis laike pagal grąžinimo grafiką. Visos sumos — lentelėje „Mokėjimų grafikas“."
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

          <path d={g.plotas} className="plotas" />
          {g.praeitis && <path d={g.praeitis} className="linija" />}
          {g.ateitis && <path d={g.ateitis} className="linija ateitis" />}

          {g.siandienX !== null && (
            <>
              <line x1={g.siandienX} x2={g.siandienX} y1={PARASTES.virsus - 6} y2={g.nulis} className="siandien" />
              <text
                x={g.siandienX + (siandienDesineje ? -6 : 6)}
                y={PARASTES.virsus - 10}
                textAnchor={siandienDesineje ? 'end' : 'start'}
                className="siandien-tekstas"
              >
                šiandien · {eur(dabartinisLikutis)}
              </text>
            </>
          )}

          {taskas && (
            <>
              <line x1={taskoX} x2={taskoX} y1={PARASTES.virsus} y2={g.nulis} className="kryzius" />
              <circle cx={taskoX} cy={g.y(taskas.balance)} r={4} className="taskas" />
            </>
          )}
        </svg>
      )}

      {taskas && (
        <div
          className="grafiko-patarimas"
          style={{ left: Math.min(plotis - 120, Math.max(120, taskoX)) }}
          role="status"
        >
          <span>{taskas.date}</span>
          <strong>{eur(taskas.balance)}</strong>
          {taskas.payment !== null && (
            <span>
              įmoka {eur(taskas.payment)} · kreditui {eur(taskas.principal ?? 0)} · palūkanoms{' '}
              {eur(taskas.interest ?? 0)}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
