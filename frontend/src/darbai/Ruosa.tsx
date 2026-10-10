import { useState } from 'react'
import Zinute from '../Zinute'
import type { Narys, Sritis, Uzduotis } from './api'
import { data, dienuSkirtumas, inicialai, pakartojimoTekstas, siandien, skaitytiPakartojima, terminas } from './datos'
import { useNariai } from './nariai'
import RuososDialogas from './RuososDialogas'
import { pagalTermina } from './tvarka'
import { useUzduotys } from './useUzduotys'

/** Kiek dienų apytiksliai tarp kartų — „retesniems“ atskirti. */
function periodas(taisykle: string | null): number {
  const p = skaitytiPakartojima(taisykle)
  const vienas = p.rusis === 'diena' ? 1 : p.rusis === 'savaite' ? 7 : p.rusis === 'menuo' ? 30 : 365
  return vienas * p.kasKiek
}

/** Retesni nei kas 4 savaites — atskiroje grupėje („Šaldytuvo valymas · liko 6 d.“). */
const RETESNI_NUO = 28

const eile = (u: Uzduotis) => (u.rotation_members ? (JSON.parse(u.rotation_members) as number[]) : [])

type Grupe = { raktas: string; pavadinimas: string; darbai: Uzduotis[] }

function grupuoti(ruosa: Uzduotis[], nariai: Narys[]): Grupe[] {
  const retesni = ruosa.filter((u) => periodas(u.recurrence) >= RETESNI_NUO)
  const daznesni = ruosa.filter((u) => periodas(u.recurrence) < RETESNI_NUO)
  return [
    ...nariai.map((n) => ({
      raktas: `n${n.id}`,
      pavadinimas: n.name,
      darbai: daznesni.filter((u) => eile(u).length === 0 && u.assignee_id === n.id),
    })),
    { raktas: 'pakaitomis', pavadinimas: 'Pakaitomis', darbai: daznesni.filter((u) => eile(u).length > 0) },
    { raktas: 'betkas', pavadinimas: 'Bet kas', darbai: daznesni.filter((u) => eile(u).length === 0 && u.assignee_id === null) },
    { raktas: 'retesni', pavadinimas: 'Retesni', darbai: retesni },
  ].filter((g) => g.darbai.length > 0)
}

/**
 * Namų ruoša: pasikartojantys buities darbai, sugrupuoti pagal tai, kas juos daro. Apskritimas —
 * atlikta (su „Atšaukti“), pakaitomis darbas pats atitenka kitam; apačioje — kas už ką atsakingas.
 */
export default function Ruosa() {
  const { nariai } = useNariai()
  const { uzduotys, sritys, klaida, load, atlikti, zinute, setZinute } = useUzduotys()
  const [atidaryta, setAtidaryta] = useState<Uzduotis | 'nauja' | null>(null)
  const siandiena = siandien()

  const ruosa = (uzduotys ?? []).filter((u) => u.chore && u.parent_id === null && u.status === 'atvira').sort(pagalTermina)
  const vardas = (id: number | null) => nariai.find((n) => n.id === id)?.name

  const eilute = (u: Uzduotis, retesnis: boolean) => {
    const narys = nariai.find((n) => n.id === u.assignee_id)
    const kiek = u.due_date ? dienuSkirtumas(siandiena, u.due_date) : null
    const due = u.due_date ? terminas(u.due_date, siandiena) : null
    const kada = due && (retesnis && kiek !== null && kiek > 1 ? { tekstas: `liko ${kiek} d.`, veluoja: false } : due)
    const kas = eile(u)
    return (
      <li key={u.id} className="uzd-eilute">
        <button className="uzd-zyme" onClick={() => void atlikti(u)} aria-label={`Pažymėti „${u.title}“ atlikta`} title="Atlikta">
          <span aria-hidden="true" />
        </button>
        <button className="uzd-tekstas" onClick={() => setAtidaryta(u)}>
          <span className="uzd-pavadinimas">{u.title}</span>
          <span className="uzd-meta">
            {kada && <span className={kada.veluoja ? 'veluoja' : undefined}>{kada.tekstas}</span>}
            {u.recurrence && (
              <span>
                ↻ {pakartojimoTekstas(u.recurrence)}
                {u.repeat_after_done ? ' nuo paskutinio karto' : ''}
              </span>
            )}
            {kas.length > 0 && <span>dabar {vardas(u.assignee_id) ?? '—'}</span>}
            {u.completed_at && (
              <span>
                paskutinį kartą {vardas(u.completed_by) ? `${vardas(u.completed_by)}, ` : ''}
                {data(u.completed_at.slice(0, 10), siandiena)}
              </span>
            )}
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

  return (
    <div className="uzduotys ruosa">
      <div className="ruosa-virsus">
        <p className="paaiskinimas">Pasikartojantys namų darbai. Kai ateina diena, jie atsiranda ir „Šiandien“.</p>
        <button onClick={() => setAtidaryta('nauja')}>+ Nauja ruoša</button>
      </div>

      {klaida && <p className="error">{klaida}</p>}
      {!uzduotys && !klaida && <p className="paaiskinimas">Kraunama…</p>}
      {uzduotys && ruosa.length === 0 && (
        <p className="tuscia">
          Ruošos dar nėra. Spausk „+ Nauja ruoša“ arba pasakyk katinukui, pvz.: „kiekvieną šeštadienį tėtis siurbia, vonią valom
          pakaitomis kas dvi savaites“.
        </p>
      )}

      {grupuoti(ruosa, nariai).map((g) => (
        <section key={g.raktas} className="kortele-sarasas uzd-grupe">
          <header>
            <h2>{g.pavadinimas}</h2>
          </header>
          <ul className="uzd-sarasas">{g.darbai.map((u) => eilute(u, g.raktas === 'retesni'))}</ul>
        </section>
      ))}

      {uzduotys && <KasUzKa ruosa={ruosa} sritys={sritys} />}

      {atidaryta && (
        <RuososDialogas
          ruosa={atidaryta === 'nauja' ? null : atidaryta}
          sritys={sritys}
          onUzdaryti={() => setAtidaryta(null)}
          onPakeista={load}
        />
      )}

      <Zinute zinute={zinute} onUzdaryti={() => setZinute(null)} />
    </div>
  )
}

/** „Kas už ką atsakingas“: kiekvienam — jo sritys ir ruoša; atskirai — pakaitomis ir bendra. */
function KasUzKa({ ruosa, sritys }: { ruosa: Uzduotis[]; sritys: Sritis[] }) {
  const { nariai } = useNariai()
  const kortele = (pavadinimas: string, sritysTekstu: string[], darbai: string[]) =>
    sritysTekstu.length + darbai.length === 0 ? null : (
      <div key={pavadinimas} className="kas-uz-ka-kortele">
        <b>{pavadinimas}</b>
        {sritysTekstu.length > 0 && <span className="paaiskinimas">Sritys: {sritysTekstu.join(', ')}</span>}
        {darbai.length > 0 && <span className="paaiskinimas">Ruoša: {darbai.join(', ')}</span>}
      </div>
    )
  const pakaitomis = ruosa.filter((u) => u.rotation_members)
  const korteles = [
    ...nariai.map((n) =>
      kortele(
        n.name,
        sritys.filter((s) => s.default_member_id === n.id).map((s) => s.name),
        ruosa.filter((u) => !u.rotation_members && u.assignee_id === n.id).map((u) => u.title)
      )
    ),
    kortele(
      'Pakaitomis',
      [],
      pakaitomis.map((u) => `${u.title} (${eile(u).map((id) => nariai.find((n) => n.id === id)?.name ?? id).join(' → ')})`)
    ),
    kortele(
      'Bendra — bet kas',
      sritys.filter((s) => s.default_member_id === null).map((s) => s.name),
      ruosa.filter((u) => !u.rotation_members && u.assignee_id === null).map((u) => u.title)
    ),
  ].filter(Boolean)

  return (
    <section className="kortele-sarasas kas-uz-ka">
      <header>
        <h2>Kas už ką atsakingas</h2>
      </header>
      <p className="paaiskinimas">Sritis ir jų atsakingus keisk: Daugiau → Sritys ir atsakingi; ruošą — paspaudęs ją sąraše.</p>
      <div className="kas-uz-ka-tinklelis">{korteles}</div>
    </section>
  )
}
