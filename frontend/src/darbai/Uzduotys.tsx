import { useEffect, useState } from 'react'
import Zinute from '../Zinute'
import { darbai, type Narys, type Projektas, type Sritis, type Uzduotis } from './api'
import { pridetiDienu, savaitesDiena, siandien } from './datos'
import { useNariai } from './nariai'
import { darbuZodis, pagalTermina } from './tvarka'
import UzduotiesDialogas from './UzduotiesDialogas'
import UzduotiesEilute from './UzduotiesEilute'
import { useUzduotys } from './useUzduotys'

type Grupavimas = 'sritis' | 'zmogus' | 'terminas' | 'projektas'
type Filtras = 'visi' | 'mano'

type Grupe = { raktas: string; pavadinimas: string; ikona: string; uzduotys: Uzduotis[] }

function grupuoti(
  uzduotys: Uzduotis[],
  kaip: Grupavimas,
  sritys: Sritis[],
  nariai: Narys[],
  siandiena: string,
  projektai: Projektas[]
): Grupe[] {
  const surikiuotos = [...uzduotys].sort(pagalTermina)

  if (kaip === 'projektas') {
    const zinomi = new Set(projektai.map((p) => p.id))
    return [
      ...projektai.map((p) => ({
        raktas: `p${p.id}`,
        pavadinimas: p.title,
        ikona: '◆',
        uzduotys: surikiuotos.filter((u) => u.project_id === p.id),
      })),
      {
        raktas: 'p-',
        pavadinimas: 'Be projekto',
        ikona: '•',
        uzduotys: surikiuotos.filter((u) => u.project_id === null || !zinomi.has(u.project_id)),
      },
    ]
  }

  if (kaip === 'sritis') {
    const zinomos = new Set(sritys.map((s) => s.id))
    return [
      ...sritys.map((s) => ({
        raktas: `s${s.id}`,
        pavadinimas: s.name,
        ikona: s.icon ?? '•',
        uzduotys: surikiuotos.filter((u) => u.area_id === s.id),
      })),
      {
        raktas: 's-',
        pavadinimas: 'Be srities',
        ikona: '•',
        uzduotys: surikiuotos.filter((u) => u.area_id === null || !zinomos.has(u.area_id)),
      },
    ]
  }

  if (kaip === 'zmogus') {
    return [
      ...nariai.map((n) => ({
        raktas: `n${n.id}`,
        pavadinimas: n.name,
        ikona: '●',
        uzduotys: surikiuotos.filter((u) => u.assignee_id === n.id),
      })),
      { raktas: 'n-', pavadinimas: 'Bet kas', ikona: '○', uzduotys: surikiuotos.filter((u) => u.assignee_id === null) },
    ]
  }

  const rytoj = pridetiDienu(siandiena, 1)
  const savaitesGalas = pridetiDienu(siandiena, 6 - savaitesDiena(siandiena))
  const kur = (u: Uzduotis) => {
    if (!u.due_date) return 'be'
    if (u.due_date < siandiena) return 'veluoja'
    if (u.due_date === siandiena) return 'siandien'
    if (u.due_date === rytoj) return 'rytoj'
    if (u.due_date <= savaitesGalas) return 'savaite'
    return 'veliau'
  }
  const kibirai: [string, string, string][] = [
    ['veluoja', 'Vėluoja', '!'],
    ['siandien', 'Šiandien', '◉'],
    ['rytoj', 'Rytoj', '→'],
    ['savaite', 'Šią savaitę', '◷'],
    ['veliau', 'Vėliau', '…'],
    ['be', 'Be termino', '○'],
  ]
  return kibirai.map(([raktas, pavadinimas, ikona]) => ({
    raktas,
    pavadinimas,
    ikona,
    uzduotys: surikiuotos.filter((u) => kur(u) === raktas),
  }))
}

function skaityti<T extends string>(raktas: string, galimos: T[], numatyta: T): T {
  try {
    const v = localStorage.getItem(raktas) as T | null
    return v && galimos.includes(v) ? v : numatyta
  } catch {
    return numatyta
  }
}

function rasyti(raktas: string, reiksme: string) {
  try {
    localStorage.setItem(raktas, reiksme)
  } catch {
    // Privačiame lange nustatymas tiesiog neįsimenamas.
  }
}

type Props = {
  /** Atidaryti šią užduotį, kai sąrašas pasikraus (atėjus iš pranešimo). */
  pradinisId?: number | null
  onAtidarytiProjekta?: (p: Projektas) => void
}

/** Visos užduotys, sugrupuotos; viršuje — greitas įvedimas. */
export default function Uzduotys({ pradinisId = null, onAtidarytiProjekta }: Props) {
  const { nariai, as } = useNariai()
  const { uzduotys, sritys, klaida, setKlaida, load, atlikti, zinute, setZinute } = useUzduotys()
  const [grupavimas, setGrupavimas] = useState<Grupavimas>(() =>
    skaityti('uzduociu-grupavimas', ['sritis', 'zmogus', 'terminas', 'projektas'], 'sritis')
  )
  const [filtras, setFiltras] = useState<Filtras>(() => skaityti('uzduociu-filtras', ['visi', 'mano'], 'visi'))
  const [atidaryta, setAtidaryta] = useState<Uzduotis | 'nauja' | null>(null)
  // Atėjus iš pranešimo užduotis atsidaro, kai sąrašas pasikrauna.
  const [laukiamaId, setLaukiamaId] = useState(pradinisId)
  const [greita, setGreita] = useState('')
  const [rodytiAtliktas, setRodytiAtliktas] = useState(false)
  const siandiena = siandien()
  const [projektai, setProjektai] = useState<Projektas[]>([])
  useEffect(() => {
    darbai
      .projektai()
      .then(setProjektai)
      .catch(() => setProjektai([]))
  }, [])
  const projektoVardas = (id: number | null) => projektai.find((p) => p.id === id)?.title

  const laukiama = laukiamaId !== null && uzduotys ? (uzduotys.find((u) => u.id === laukiamaId) ?? null) : undefined
  const rodoma = atidaryta ?? laukiama ?? null
  const uzdaryti = () => {
    setAtidaryta(null)
    setLaukiamaId(null)
  }

  const visos = uzduotys ?? []
  // Ruoša — savo skirtuke („Darbai → Ruoša“), čia jos nerodom.
  const virsutines = visos.filter(
    (u) => u.parent_id === null && !u.chore && (filtras === 'visi' || u.assignee_id === as || u.assignee_id === null)
  )
  const atviros = virsutines.filter((u) => u.status === 'atvira')
  const atliktos = virsutines.filter((u) => u.status === 'atlikta')
  const grupes = grupuoti(atviros, grupavimas, sritys, nariai, siandiena, projektai).filter((g) => g.uzduotys.length > 0)

  async function greitaiPrideti() {
    const title = greita.trim()
    if (!title) return
    setGreita('')
    try {
      await darbai.sukurti({ title }, as)
      load()
    } catch (err) {
      setKlaida(err instanceof Error ? err.message : 'Nepavyko pridėti.')
      setGreita(title)
    }
  }

  const eilute = (u: Uzduotis) => (
    <UzduotiesEilute
      key={u.id}
      uzduotis={u}
      visos={visos}
      sritys={sritys}
      siandiena={siandiena}
      rodytiSriti={grupavimas !== 'sritis'}
      projektas={grupavimas !== 'projektas' ? projektoVardas(u.project_id) : undefined}
      onAtlikti={atlikti}
      onAtidaryti={setAtidaryta}
    />
  )

  return (
    <div className="uzduotys">
      <form
        className="uzd-greitai"
        onSubmit={(e) => {
          e.preventDefault()
          void greitaiPrideti()
        }}
      >
        <input value={greita} onChange={(e) => setGreita(e.target.value)} placeholder="Nauja užduotis…" maxLength={300} />
        <button type="submit" disabled={!greita.trim()}>
          Pridėti
        </button>
        {/* Ne „Daugiau“ — taip vadinasi apatinis meniu, painiojosi. */}
        <button type="button" className="ghost" onClick={() => setAtidaryta('nauja')} title="Nauja užduotis su terminu, atsakingu, priminimais">
          Išsamiau…
        </button>
      </form>

      <div className="uzd-valdikliai">
        <div className="perjungiklis" role="group" aria-label="Grupuoti">
          {(
            [
              ['sritis', 'Sritis'],
              ['zmogus', 'Žmogus'],
              ['terminas', 'Terminas'],
              ['projektas', 'Projektas'],
            ] as const
          ).map(([reiksme, vardas]) => (
            <button
              key={reiksme}
              aria-pressed={grupavimas === reiksme}
              onClick={() => {
                setGrupavimas(reiksme)
                rasyti('uzduociu-grupavimas', reiksme)
              }}
            >
              {vardas}
            </button>
          ))}
        </div>
        <div className="perjungiklis" role="group" aria-label="Kieno">
          {(
            [
              ['visi', 'Visi'],
              ['mano', 'Mano'],
            ] as const
          ).map(([reiksme, vardas]) => (
            <button
              key={reiksme}
              aria-pressed={filtras === reiksme}
              onClick={() => {
                setFiltras(reiksme)
                rasyti('uzduociu-filtras', reiksme)
              }}
            >
              {vardas}
            </button>
          ))}
        </div>
      </div>

      {klaida && <p className="error">{klaida}</p>}
      {laukiama === null && <p className="error">Šios užduoties sąraše nebėra — gal ji ištrinta ar seniai atlikta.</p>}
      {!uzduotys && !klaida && <p className="paaiskinimas">Kraunama…</p>}
      {uzduotys && atviros.length === 0 && (
        <p className="tuscia">
          {virsutines.length === 0
            ? 'Užduočių dar nėra. Įrašyk pirmą aukščiau — pavyzdžiui, „Pakeisti lemputę koridoriuje“.'
            : 'Visos užduotys atliktos ✓'}
        </p>
      )}

      {grupes.map((g) => (
        <section key={g.raktas} className="kortele-sarasas uzd-grupe">
          <header>
            <h2>
              <span aria-hidden="true">{g.ikona}</span> {g.pavadinimas}
            </h2>
            {g.raktas.startsWith('p') && g.raktas !== 'p-' && onAtidarytiProjekta && (
              <button
                className="linkish"
                onClick={() => {
                  const p = projektai.find((x) => `p${x.id}` === g.raktas)
                  if (p) onAtidarytiProjekta(p)
                }}
              >
                atidaryti →
              </button>
            )}
            <span className="paaiskinimas">{darbuZodis(g.uzduotys.length)}</span>
          </header>
          <ul className="uzd-sarasas">{g.uzduotys.map(eilute)}</ul>
        </section>
      ))}

      {atliktos.length > 0 && (
        <section className="uzd-atliktos">
          <button className="linkish" onClick={() => setRodytiAtliktas(!rodytiAtliktas)} aria-expanded={rodytiAtliktas}>
            {rodytiAtliktas ? '▾' : '▸'} Atlikta per 3 dienas ({atliktos.length})
          </button>
          {rodytiAtliktas && <ul className="uzd-sarasas">{atliktos.sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? '')).map(eilute)}</ul>}
        </section>
      )}

      {rodoma && (
        <UzduotiesDialogas
          uzduotis={rodoma === 'nauja' ? null : (visos.find((u) => u.id === rodoma.id) ?? rodoma)}
          visos={visos}
          sritys={sritys}
          onUzdaryti={uzdaryti}
          onPakeista={load}
        />
      )}

      <Zinute zinute={zinute} onUzdaryti={() => setZinute(null)} />
    </div>
  )
}
