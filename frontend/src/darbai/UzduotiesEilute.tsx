import { eur } from '../api'
import type { Sritis, Uzduotis } from './api'
import { inicialai, pakartojimoTekstas, terminas } from './datos'
import { useNariai } from './nariai'

type Props = {
  uzduotis: Uzduotis
  /** Visos užduotys — použduočių skaičiui. */
  visos: Uzduotis[]
  sritys: Sritis[]
  siandiena: string
  rodytiSriti?: boolean
  /** Projekto pavadinimas — rodomas žyma (kai sąrašas ne pagal projektą). */
  projektas?: string
  onAtlikti: (u: Uzduotis) => void
  onAtidaryti: (u: Uzduotis) => void
}

/** Viena užduotis sąraše: apskritimas užbaigti, paspaudus tekstą — atidaryti. */
export default function UzduotiesEilute({ uzduotis: u, visos, sritys, siandiena, rodytiSriti, projektas, onAtlikti, onAtidaryti }: Props) {
  const { nariai } = useNariai()
  const narys = nariai.find((n) => n.id === u.assignee_id)
  const sritis = sritys.find((s) => s.id === u.area_id)
  const pouzduotys = visos.filter((x) => x.parent_id === u.id)
  const atliktos = pouzduotys.filter((x) => x.status === 'atlikta').length
  const due = u.due_date ? terminas(u.due_date, siandiena) : null
  const atlikta = u.status === 'atlikta'

  return (
    <li className={`uzd-eilute${atlikta ? ' atlikta' : ''}`}>
      <button
        className="uzd-zyme"
        onClick={() => onAtlikti(u)}
        aria-label={atlikta ? `Grąžinti „${u.title}“ į neatliktas` : `Pažymėti „${u.title}“ atlikta`}
        title={atlikta ? 'Grąžinti' : 'Atlikta'}
      >
        <span aria-hidden="true">{atlikta ? '✓' : ''}</span>
      </button>

      <button className="uzd-tekstas" onClick={() => onAtidaryti(u)}>
        <span className="uzd-pavadinimas">
          {u.priority === 'svarbu' && (
            <span className="uzd-svarbu" title="Svarbu">
              !
            </span>
          )}
          {u.title}
        </span>
        <span className="uzd-meta">
          {due && !atlikta && (
            <span className={due.veluoja ? 'veluoja' : undefined}>
              {due.tekstas}
              {u.due_time && ` ${u.due_time}`}
            </span>
          )}
          {u.reminders.length > 0 && !atlikta && <span>🔔</span>}
          {u.recurrence && (
            <span title={pakartojimoTekstas(u.recurrence)}>
              ↻ {pakartojimoTekstas(u.recurrence)}
              {u.repeat_after_done ? ' nuo paskutinio karto' : ''}
            </span>
          )}
          {projektas && <span>◆ {projektas}</span>}
          {rodytiSriti && sritis && (
            <span>
              {sritis.icon} {sritis.name}
            </span>
          )}
          {pouzduotys.length > 0 && (
            <span>
              ☑ {atliktos}/{pouzduotys.length}
            </span>
          )}
          {u.amount_cents !== null && <span>{eur(u.amount_cents)}</span>}
          {u.priority === 'kada_nors' && <span>kada nors</span>}
        </span>
      </button>

      {narys && (
        <span className="uzd-narys" style={{ background: narys.color }} title={narys.name}>
          {inicialai(narys.name)}
        </span>
      )}
    </li>
  )
}
