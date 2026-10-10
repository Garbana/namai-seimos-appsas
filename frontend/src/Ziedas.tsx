import { useMemo } from 'react'
import { eur } from './api'

export type ZiedoDalis = { id: number; vardas: string; suma: number }

type Props = {
  dalys: ZiedoDalis[]
  /** Užrašas žiedo viduryje virš sumos. */
  etikete?: string
  /** Kiek didžiausių dalių rodoma atskirai; likusios sudedamos į „Kita". */
  atskirai?: number
  /** Ar rodyti legendą po žiedu. */
  legenda?: boolean
}

/** Viena spalva nuo tamsios iki šviesios — dalims pagal dydį. */
const RAMPA = ['var(--r1)', 'var(--r2)', 'var(--r3)', 'var(--r4)', 'var(--r5)', 'var(--r6)']
/** Nepriskirtų operacijų dalies žymuo (žr. Pradžią ir Biudžetą). */
export const BE_KATEGORIJOS = -2

const SPINDULYS = 72
const STORIS = 18
const APIMTIS = 2 * Math.PI * SPINDULYS

/**
 * Išlaidų žiedas. Dalys rikiuojamos pagal dydį, tad viena spalva su gradacijomis
 * perteikia ir tvarką; ką kuri dalis reiškia, pasako legenda.
 */
export default function Ziedas({ dalys, etikete = 'Išlaidos', atskirai = 5, legenda = true }: Props) {
  const viso = dalys.reduce((s, d) => s + d.suma, 0)

  const segmentai = useMemo(() => {
    const surikiuotos = [...dalys].sort((a, b) => b.suma - a.suma)
    const virsus = surikiuotos.slice(0, atskirai)
    const likusios = surikiuotos.slice(atskirai)
    const sarasas = [...virsus]
    if (likusios.length > 0) {
      sarasas.push({
        id: -1,
        vardas: `Kita (${likusios.length} gr.)`,
        suma: likusios.reduce((s, g) => s + g.suma, 0),
      })
    }

    let pradzia = 0
    return sarasas.map((dalis, i) => {
      const ilgis = viso > 0 ? (dalis.suma / viso) * APIMTIS : 0
      const poslinkis = pradzia
      pradzia += ilgis
      return {
        ...dalis,
        ilgis,
        poslinkis,
        dalis: viso > 0 ? dalis.suma / viso : 0,
        // Nepriskirtos — neutralia spalva, nes tai dar ne atsakymas, o klausimas.
        spalva: dalis.id === BE_KATEGORIJOS ? 'var(--remas)' : RAMPA[i % RAMPA.length],
      }
    })
  }, [dalys, atskirai, viso])

  if (viso <= 0) return <p className="tuscia">Šį mėnesį išlaidų dar nėra.</p>

  return (
    <>
      <div className="ziedas">
        <svg
          width="210"
          height="210"
          viewBox="0 0 210 210"
          role="img"
          aria-label={`${etikete} pagal grupes, iš viso ${eur(viso)}`}
        >
          <g transform="rotate(-90 105 105)" fill="none" strokeWidth={STORIS}>
            {segmentai.map((s) => (
              <circle
                key={s.id}
                cx="105"
                cy="105"
                r={SPINDULYS}
                stroke={s.spalva}
                strokeDasharray={`${s.ilgis} ${APIMTIS}`}
                strokeDashoffset={-s.poslinkis}
              />
            ))}
          </g>
        </svg>
        <div className="ziedo-vidus">
          <span className="etikete">{etikete}</span>
          <strong className="suma">{eur(viso)}</strong>
        </div>
      </div>

      {legenda && (
        <ul className="legenda">
          {segmentai.map((s) => (
            <li key={s.id}>
              <i style={{ background: s.spalva }} aria-hidden="true" />
              <span>
                {s.vardas}
                <small> {Math.round(s.dalis * 100)} %</small>
              </span>
              <b className="num">{eur(s.suma)}</b>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
