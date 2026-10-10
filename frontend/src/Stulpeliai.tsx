import { eur, menuoVardas } from './api'

export type Stulpelis = { month: string; suma: number }

type Props = {
  menesiai: Stulpelis[]
  /** Kuris mėnuo paryškintas (pasirinktas). */
  pasirinktas?: string | null
  onPasirinkti?: (month: string) => void
  ariaLabel: string
}

/**
 * Išlaidos per mėnesius. Stulpeliai HTML'u, ne SVG — taip jie patys prisitaiko
 * prie pločio, o reikšmės niekada neužlipa viena ant kitos.
 *
 * Nebaigtas mėnuo pažymimas atskirai: jo suma dar augs, tad lyginti su kitais
 * negalima.
 */
export default function Stulpeliai({ menesiai, pasirinktas, onPasirinkti, ariaLabel }: Props) {
  if (menesiai.length === 0) return <p className="tuscia">Duomenų dar nėra.</p>

  const didziausia = Math.max(...menesiai.map((m) => m.suma), 1)
  const vidurkis = menesiai.reduce((s, m) => s + m.suma, 0) / menesiai.length
  const sisMenuo = new Date().toISOString().slice(0, 7)

  return (
    <div className="stulpeliai" role="group" aria-label={ariaLabel}>
      <div className="stulpeliu-sritis">
        <div
          className="vidurkio-linija"
          style={{ bottom: `${(vidurkis / didziausia) * 100}%` }}
          aria-hidden="true"
        >
          <span>vidurkis {eur(vidurkis)}</span>
        </div>

        {menesiai.map((m) => {
          const aukstis = (m.suma / didziausia) * 100
          const nebaigtas = m.month === sisMenuo
          return (
            <button
              key={m.month}
              className={`stulpelio-blokas${m.month === pasirinktas ? ' pasirinktas' : ''}`}
              onClick={() => onPasirinkti?.(m.month)}
              title={`${menuoVardas(m.month)}: ${eur(m.suma)}${nebaigtas ? ' (mėnuo dar nesibaigė)' : ''}`}
            >
              <span className="reiksme num" style={{ bottom: `calc(${aukstis}% + 6px)` }}>
                {eur(m.suma)}
              </span>
              <span
                className={nebaigtas ? 'stulpelis nebaigtas' : 'stulpelis'}
                style={{ height: `${aukstis}%` }}
              />
            </button>
          )
        })}
      </div>

      <div className="stulpeliu-etiketes">
        {menesiai.map((m) => (
          <span key={m.month} className={m.month === pasirinktas ? 'pasirinktas' : undefined}>
            {menuoVardas(m.month, true)}
          </span>
        ))}
      </div>
    </div>
  )
}
