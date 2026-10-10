import { eur } from '../api'
import type { Projektas } from './api'
import { pilnaDataSuMetais } from './datos'
import { useNariai } from './nariai'
import { biudzetoTikslas, likoTekstas } from './projektuTvarka'

/** Progreso juosta su užrašu. */
export function Juosta({ pavadinimas, verte, viso, tekstas, virsyta = false }: { pavadinimas: string; verte: number; viso: number; tekstas: string; virsyta?: boolean }) {
  const dalis = viso > 0 ? Math.min(verte / viso, 1) : 0
  return (
    <span className="projekto-juosta">
      <span className="projekto-juosta-pavadinimas">{pavadinimas}</span>
      <span className={`projekto-juosta-fonas${virsyta ? ' virsyta' : ''}`} aria-hidden="true">
        <span style={{ width: `${Math.round(dalis * 100)}%` }} />
      </span>
      <span className="projekto-juosta-tekstas">{tekstas}</span>
    </span>
  )
}

/** Projekto kortelė sąraše ir „Šiandien“: data, kiek liko, darbų ir biudžeto progresas. */
export default function ProjektoKortele({ projektas: p, siandiena, onClick }: { projektas: Projektas; siandiena: string; onClick: () => void }) {
  const { nariai } = useNariai()
  const atsakingas = nariai.find((n) => n.id === p.owner_id)?.name
  const tikslas = biudzetoTikslas(p)
  const eilute = [
    p.target_date ? `${pilnaDataSuMetais(p.target_date)} · ${likoTekstas(p.target_date, siandiena)}` : null,
    atsakingas,
    p.status === 'atidetas' ? 'atidėtas' : p.status === 'baigtas' ? 'baigtas' : null,
  ].filter(Boolean)

  return (
    <button className="projekto-kortele" onClick={onClick}>
      <span className="projekto-kortele-pavadinimas">{p.title}</span>
      {eilute.length > 0 && <span className="paaiskinimas">{eilute.join(' · ')}</span>}
      {p.tasks_total > 0 && (
        <Juosta pavadinimas="Darbai" verte={p.tasks_done} viso={p.tasks_total} tekstas={`${p.tasks_done} iš ${p.tasks_total}`} />
      )}
      {tikslas !== null && (
        <Juosta
          pavadinimas="Biudžetas"
          verte={p.actual_cents}
          viso={tikslas}
          tekstas={`${eur(p.actual_cents)} iš ${eur(tikslas)}`}
          virsyta={p.actual_cents > tikslas}
        />
      )}
    </button>
  )
}
