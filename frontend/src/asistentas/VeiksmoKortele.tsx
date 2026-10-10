import { eur } from '../api'
import type { Sritis, UzduotiesLaukai } from '../darbai/api'
import { data, pakartojimoTekstas, pilnaData, pilnaDataSuMetais, priminimoTekstas, siandien } from '../darbai/datos'
import { useNariai } from '../darbai/nariai'
import { RUSYS } from '../pastabos/api'
import type { Veiksmas } from './api'

type Props = {
  v: Veiksmas
  sritys: Sritis[]
  dirbama: boolean
  onPatvirtinti: () => void
  onTaisyti?: () => void
  onAtmesti: () => void
  onAtsaukti: () => void
}

const LAUKAI: Record<string, string> = {
  title: 'Pavadinimas',
  dueDate: 'Terminas',
  dueTime: 'Laikas',
  assigneeId: 'Atsakingas',
  areaId: 'Sritis',
  priority: 'Prioritetas',
  recurrence: 'Pasikartoja',
  reminders: 'Priminti',
  amountCents: 'Suma',
  notes: 'Pastabos',
  chore: 'Ruoša',
  rotationMembers: 'Pakaitomis',
  repeatAfterDone: 'Nuo paskutinio karto',
}

const PRIORITETAI: Record<string, string> = { svarbu: 'Svarbu', iprasta: 'Įprasta', kada_nors: 'Kada nors' }

const ANTRASTES: Record<Veiksmas['tipas'], Partial<Record<Veiksmas['busena'], string>>> = {
  sukurti: { laukia: 'Nauja užduotis', ivykdyta: '✓ Įrašyta' },
  keisti: { laukia: 'Pakeisti užduotį', ivykdyta: '✓ Pakeista' },
  istrinti: { laukia: 'Ištrinti užduotį', ivykdyta: '✓ Ištrinta — 30 d. bus šiukšliadėžėje' },
  atlikta: { ivykdyta: '✓ Atlikta' },
  pirkiniai: { ivykdyta: '✓ Į pirkinių sąrašą' },
  nupirkta: { ivykdyta: '✓ Nupirkta' },
  pastaba: { ivykdyta: '✓ Užfiksuota pastaba — Claude pažiūrės' },
  projektas: { laukia: 'Naujas projektas', ivykdyta: '✓ Projektas sukurtas — rasite Darbai → Projektai' },
  islaida: { ivykdyta: '✓ Įrašyta į projekto biudžetą' },
  ivykis: { laukia: 'Naujas įvykis kalendoriuje', ivykdyta: '✓ Kalendoriuje' },
  ivykio_keitimas: { laukia: 'Pakeisti įvykį', ivykdyta: '✓ Įvykis pakeistas' },
  ivykio_trynimas: { laukia: 'Ištrinti įvykį', ivykdyta: '✓ Įvykis ištrintas' },
}

const IVYKIO_LAUKAI: Record<string, string> = {
  title: 'Pavadinimas',
  startDate: 'Diena',
  startTime: 'Nuo',
  endDate: 'Iki dienos',
  endTime: 'Iki',
  memberIds: 'Dalyvauja',
  location: 'Vieta',
  notes: 'Pastabos',
  recurrence: 'Pasikartoja',
}

const BUSENOS: Partial<Record<Veiksmas['busena'], string>> = {
  atmesta: 'Atmesta',
  pakeista: 'Pakeista nauju pasiūlymu',
  atsaukta: 'Atšaukta',
}

/** Vienas asistento veiksmas: ką pasiūlė ar padarė, su „Patvirtinti“ ar „Atšaukti“. */
export default function VeiksmoKortele({ v, sritys, dirbama, onPatvirtinti, onTaisyti, onAtmesti, onAtsaukti }: Props) {
  const { nariai } = useNariai()

  function reiksme(key: string, value: unknown): string {
    if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) return '—'
    switch (key) {
      case 'dueDate':
        return pilnaData(value as string)
      case 'assigneeId':
        return nariai.find((n) => n.id === value)?.name ?? '?'
      case 'areaId': {
        const s = sritys.find((x) => x.id === value)
        return s ? `${s.icon ?? ''} ${s.name}`.trim() : '?'
      }
      case 'priority':
        return PRIORITETAI[value as string] ?? String(value)
      case 'recurrence':
        return pakartojimoTekstas(value as string)
      case 'reminders':
        return (value as string[]).map(priminimoTekstas).join(', ')
      case 'amountCents':
        return eur(value as number)
      case 'chore':
      case 'repeatAfterDone':
        return value ? 'taip' : 'ne'
      case 'rotationMembers':
        return (value as number[]).map((id) => nariai.find((n) => n.id === id)?.name ?? '?').join(' → ')
      default:
        return String(value)
    }
  }

  const neaktyvus = v.busena === 'atmesta' || v.busena === 'pakeista' || v.busena === 'atsaukta'
  const antraste =
    v.busena === 'klaida' ? `Nepavyko: ${v.klaida}` : (BUSENOS[v.busena] ?? ANTRASTES[v.tipas][v.busena] ?? '')

  const naujaUzduotis = (l: UzduotiesLaukai) => {
    const pakaitomis = (l.rotationMembers?.length ?? 0) > 1
    const kas = pakaitomis
      ? `Pakaitomis: ${reiksme('rotationMembers', l.rotationMembers)}`
      : l.assigneeId != null
        ? reiksme('assigneeId', l.assigneeId)
        : 'Bet kas'
    const eilutes = [
      l.chore ? '🧹 Ruoša' : null,
      [kas, l.areaId != null ? reiksme('areaId', l.areaId) : null].filter(Boolean).join(' · '),
      l.dueDate ? `${pilnaData(l.dueDate)}${l.dueTime ? `, ${l.dueTime}` : ''}` : 'Be termino',
      l.recurrence ? `↻ ${pakartojimoTekstas(l.recurrence)}${l.repeatAfterDone ? ' nuo paskutinio karto' : ''}` : null,
      l.reminders?.length ? `🔔 ${reiksme('reminders', l.reminders)}` : null,
      l.amountCents != null ? reiksme('amountCents', l.amountCents) : null,
      l.priority === 'svarbu' ? '! Svarbu' : l.priority === 'kada_nors' ? 'Kada nors' : null,
      l.notes ? l.notes : null,
    ]
    return (
      <>
        <b className="veiksmas-pavadinimas">{l.title}</b>
        {!neaktyvus &&
          eilutes.filter(Boolean).map((e, i) => (
            <span key={i} className="veiksmas-eilute">
              {e}
            </span>
          ))}
        {!neaktyvus && (v.pouzduotys?.length ?? 0) > 0 && (
          <ul className="veiksmas-pouzduotys">
            {v.pouzduotys!.map((p) => (
              <li key={p}>☐ {p}</li>
            ))}
          </ul>
        )}
      </>
    )
  }

  let turinys
  if (v.tipas === 'sukurti' && v.laukai) {
    turinys = naujaUzduotis(v.laukai)
  } else if (v.tipas === 'keisti' && v.laukai) {
    turinys = (
      <>
        <b className="veiksmas-pavadinimas">{v.pavadinimas}</b>
        {!neaktyvus &&
          Object.entries(v.laukai).map(([key, value]) => (
            <span key={key} className="veiksmas-eilute">
              {LAUKAI[key] ?? key}: <s>{reiksme(key, v.pries?.[key as keyof UzduotiesLaukai])}</s> → <b>{reiksme(key, value)}</b>
            </span>
          ))}
      </>
    )
  } else if (v.tipas === 'projektas' && v.projektas) {
    const pr = v.projektas
    const kas = pr.ownerId != null ? reiksme('assigneeId', pr.ownerId) : null
    turinys = (
      <>
        <b className="veiksmas-pavadinimas">{pr.title}</b>
        {!neaktyvus && (
          <>
            {[pr.targetDate ? pilnaDataSuMetais(pr.targetDate) : null, kas, pr.budgetCents != null ? `biudžetas ${eur(pr.budgetCents)}` : null]
              .filter(Boolean)
              .map((e, i) => (
                <span key={i} className="veiksmas-eilute">
                  {e}
                </span>
              ))}
            {pr.goal && <span className="veiksmas-eilute">{pr.goal}</span>}
            {pr.sections.map((s) => (
              <div key={s.name} className="veiksmas-etapas">
                <span className="veiksmas-etapo-pavadinimas">{s.name}</span>
                <ul className="veiksmas-pouzduotys">
                  {s.tasks.map((t) => (
                    <li key={t.title}>
                      ☐ {t.title}
                      {t.dueDate ? ` · ${data(t.dueDate, siandien())}` : ''}
                      {t.assigneeId != null ? ` · ${reiksme('assigneeId', t.assigneeId)}` : ''}
                      {t.amountCents != null ? ` · ${eur(t.amountCents)}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {pr.costs.length > 0 && (
              <div className="veiksmas-etapas">
                <span className="veiksmas-etapo-pavadinimas">Biudžetas</span>
                <ul className="veiksmas-pouzduotys">
                  {pr.costs.map((c) => (
                    <li key={c.name}>
                      {c.name}
                      {c.plannedCents != null ? ` · ${eur(c.plannedCents)}${c.isEstimate ? '*' : ''}` : ''}
                    </li>
                  ))}
                </ul>
                {pr.costs.some((c) => c.isEstimate && c.plannedCents != null) && <span className="veiksmas-eilute">* katinuko įvertis</span>}
              </div>
            )}
          </>
        )}
      </>
    )
  } else if ((v.tipas === 'ivykis' || v.tipas === 'ivykio_trynimas') && v.ivykis) {
    const i = v.ivykis
    const kas = (i.memberIds ?? []).map((id) => nariai.find((n) => n.id === id)?.name).filter(Boolean).join(', ')
    const kada = [
      i.startDate ? pilnaData(i.startDate) : null,
      i.startTime ? `${i.startTime}${i.endTime ? `–${i.endTime}` : ''}` : 'visą dieną',
      i.endDate && i.endDate !== i.startDate ? `iki ${pilnaData(i.endDate)}` : null,
    ]
      .filter(Boolean)
      .join(', ')
    turinys = (
      <>
        <b className="veiksmas-pavadinimas">📅 {i.title}</b>
        {!neaktyvus && (
          <>
            <span className="veiksmas-eilute">{kada}</span>
            <span className="veiksmas-eilute">{kas || 'Visa šeima'}</span>
            {i.location && <span className="veiksmas-eilute">{i.location}</span>}
            {i.recurrence && <span className="veiksmas-eilute">↻ {pakartojimoTekstas(i.recurrence)}</span>}
          </>
        )}
      </>
    )
  } else if (v.tipas === 'ivykio_keitimas' && v.ivykis) {
    const verte = (key: string, value: unknown) => {
      if (value === null || value === undefined || value === '') return '—'
      if (key === 'memberIds') return (value as number[]).map((id) => nariai.find((n) => n.id === id)?.name).filter(Boolean).join(', ') || 'visa šeima'
      if (key === 'startDate' || key === 'endDate') return pilnaData(value as string)
      if (key === 'recurrence') return pakartojimoTekstas(value as string)
      return String(value)
    }
    turinys = (
      <>
        <b className="veiksmas-pavadinimas">📅 {v.pavadinimas}</b>
        {!neaktyvus &&
          Object.entries(v.ivykis).map(([key, value]) => (
            <span key={key} className="veiksmas-eilute">
              {IVYKIO_LAUKAI[key] ?? key}: <s>{verte(key, v.ivykisPries?.[key as keyof typeof v.ivykisPries])}</s> → <b>{verte(key, value)}</b>
            </span>
          ))}
      </>
    )
  } else if (v.tipas === 'islaida' && v.islaida) {
    turinys = (
      <>
        <span className="veiksmas-eilute">„{v.islaida.projektas}“</span>
        <b className="veiksmas-pavadinimas">
          {v.islaida.name}: {eur(v.islaida.actualCents)}
        </b>
      </>
    )
  } else if (v.tipas === 'pastaba' && v.pastaba) {
    turinys = (
      <>
        <span className="veiksmas-eilute">{RUSYS.find((r) => r.reiksme === v.pastaba!.kind)?.vardas}</span>
        <b className="veiksmas-pavadinimas">{v.pastaba.text}</b>
      </>
    )
  } else if (v.tipas === 'pirkiniai' || v.tipas === 'nupirkta') {
    turinys = (
      <>
        {v.tipas === 'pirkiniai' && v.pavadinimas && <span className="veiksmas-eilute">„{v.pavadinimas}“</span>}
        <b className="veiksmas-pavadinimas">
          {(v.prekes ?? []).map((p) => (p.quantity ? `${p.name} (${p.quantity})` : p.name)).join(', ')}
        </b>
      </>
    )
  } else {
    turinys = (
      <>
        <b className="veiksmas-pavadinimas">{v.pavadinimas}</b>
        {v.tipas === 'atlikta' && v.sumaCentais != null && <span className="veiksmas-eilute">Suma: {eur(v.sumaCentais)}</span>}
      </>
    )
  }

  return (
    <div className={`veiksmas veiksmas-${v.busena}`}>
      {antraste && <span className="veiksmas-antraste">{antraste}</span>}
      {turinys}
      {v.busena === 'laukia' && (
        <div className="veiksmas-mygtukai">
          <button className="small" disabled={dirbama} onClick={onPatvirtinti}>
            {v.tipas === 'istrinti' || v.tipas === 'ivykio_trynimas' ? 'Ištrinti' : 'Patvirtinti'}
          </button>
          {onTaisyti && v.tipas === 'sukurti' && !v.laukai?.chore && (
            <button className="ghost small" disabled={dirbama} onClick={onTaisyti}>
              Taisyti
            </button>
          )}
          <button className="ghost small" disabled={dirbama} onClick={onAtmesti}>
            Atmesti
          </button>
        </div>
      )}
      {v.busena === 'ivykdyta' && (
        <div className="veiksmas-mygtukai">
          <button className="ghost small" disabled={dirbama} onClick={onAtsaukti}>
            Atšaukti
          </button>
        </div>
      )}
    </div>
  )
}
