import { useCallback, useEffect, useState } from 'react'
import { eur } from '../api'
import Zinute from '../Zinute'
import { useZinute } from '../useZinute'
import { darbai, type Etapas, type Islaida, type ProjektoBusena, type ProjektoDuomenys, type Sritis, type Uzduotis } from './api'
import { pilnaData, pilnaDataSuMetais, siandien, sumaCentais } from './datos'
import IslaidosDialogas from './IslaidosDialogas'
import ProjektoBankas from './ProjektoBankas'
import { useModulis } from '../nustatymai'
import { useNariai } from './nariai'
import { Juosta } from './ProjektoKortele'
import { biudzetoTikslas, eurai, likoTekstas } from './projektuTvarka'
import { pagalTermina } from './tvarka'
import UzduotiesDialogas from './UzduotiesDialogas'
import UzduotiesEilute from './UzduotiesEilute'

type Skirtukas = 'darbai' | 'biudzetas' | 'info'

const klaidosTekstas = (err: unknown) => (err instanceof Error ? err.message : 'Nepavyko.')

const BUSENOS: { reiksme: ProjektoBusena; vardas: string }[] = [
  { reiksme: 'aktyvus', vardas: 'Aktyvus' },
  { reiksme: 'atidetas', vardas: 'Atidėtas' },
  { reiksme: 'baigtas', vardas: 'Baigtas' },
]

/** Vienas projektas: progresas, darbai pagal etapus, biudžetas ir informacija. */
export default function Projektas({ id, onAtgal }: { id: number; onAtgal: () => void }) {
  const { nariai, as } = useNariai()
  const [d, setD] = useState<ProjektoDuomenys | null>(null)
  const [sritys, setSritys] = useState<Sritis[]>([])
  const [klaida, setKlaida] = useState<string | null>(null)
  const [skirtukas, setSkirtukas] = useState<Skirtukas>('darbai')
  const [atidaryta, setAtidaryta] = useState<Uzduotis | { naujaEtape: number | null } | null>(null)
  const [islaida, setIslaida] = useState<Islaida | 'nauja' | null>(null)
  const [naujasEtapas, setNaujasEtapas] = useState('')
  const [zinute, setZinute] = useZinute()
  const siandiena = siandien()

  const load = useCallback(() => {
    darbai
      .projektas(id)
      .then(setD)
      .catch((err) => setKlaida(klaidosTekstas(err)))
  }, [id])

  useEffect(() => {
    load()
    darbai
      .sritys()
      .then(setSritys)
      .catch(() => setSritys([]))
  }, [load])

  async function veiksmas(darbas: () => Promise<unknown>) {
    setKlaida(null)
    try {
      await darbas()
      load()
    } catch (err) {
      setKlaida(klaidosTekstas(err))
    }
  }

  async function atlikti(u: Uzduotis) {
    if (u.status === 'atlikta') return veiksmas(() => darbai.atsaukti(u.id))
    try {
      const { nextDue } = await darbai.atlikta(u.id, as)
      load()
      setZinute({
        tekstas: nextDue ? `Atlikta. Kitą kartą — ${pilnaData(nextDue)}` : `Atlikta: ${u.title}`,
        veiksmas: { pavadinimas: 'Atšaukti', atlikti: () => void veiksmas(() => darbai.atsaukti(u.id)) },
      })
    } catch (err) {
      setKlaida(klaidosTekstas(err))
    }
  }

  if (!d) {
    return (
      <div className="projektas">
        <button className="linkish" onClick={onAtgal}>
          ← Projektai
        </button>
        {klaida ? <p className="error">{klaida}</p> : <p className="paaiskinimas">Kraunama…</p>}
      </div>
    )
  }

  const p = d.project
  const tikslas = biudzetoTikslas(p)
  const virsutines = d.tasks.filter((t) => t.parent_id === null)
  const eilute = (u: Uzduotis) => (
    <UzduotiesEilute
      key={u.id}
      uzduotis={u}
      visos={d.tasks}
      sritys={sritys}
      siandiena={siandiena}
      onAtlikti={(x) => void atlikti(x)}
      onAtidaryti={setAtidaryta}
    />
  )
  const tvarka = (a: Uzduotis, b: Uzduotis) => (a.status === b.status ? pagalTermina(a, b) : a.status === 'atvira' ? -1 : 1)
  const grupes: { etapas: Etapas | null; uzduotys: Uzduotis[] }[] = [
    ...d.sections.map((s) => ({ etapas: s, uzduotys: virsutines.filter((t) => t.section_id === s.id).sort(tvarka) })),
    { etapas: null, uzduotys: virsutines.filter((t) => t.section_id === null || !d.sections.some((s) => s.id === t.section_id)).sort(tvarka) },
  ]

  return (
    <div className="projektas">
      <button className="linkish projektas-atgal" onClick={onAtgal}>
        ← Projektai
      </button>

      <section className="kortele-sarasas projekto-virsus">
        {p.target_date && (
          <p className="projekto-data">
            {pilnaDataSuMetais(p.target_date)} · <b>{likoTekstas(p.target_date, siandiena)}</b>
          </p>
        )}
        {p.goal && <p className="paaiskinimas">{p.goal}</p>}
        <Juosta pavadinimas="Darbai" verte={p.tasks_done} viso={p.tasks_total} tekstas={`${p.tasks_done} iš ${p.tasks_total}`} />
        {tikslas !== null && (
          <Juosta
            pavadinimas="Biudžetas"
            verte={p.actual_cents}
            viso={tikslas}
            tekstas={`${eur(p.actual_cents)} iš ${eur(tikslas)}`}
            virsyta={p.actual_cents > tikslas}
          />
        )}
        {d.savings && (
          <Juosta
            pavadinimas="Sukaupta"
            verte={d.savings.valueCents}
            viso={tikslas ?? d.savings.targetCents ?? d.savings.valueCents}
            tekstas={`${eur(d.savings.valueCents)}${(tikslas ?? d.savings.targetCents) !== null ? ` iš ${eur((tikslas ?? d.savings.targetCents)!)}` : ''} · ${d.savings.name}`}
          />
        )}
      </section>

      <div className="perjungiklis" role="group" aria-label="Projekto skiltis">
        {(
          [
            ['darbai', 'Darbai'],
            ['biudzetas', 'Biudžetas'],
            ['info', 'Info'],
          ] as const
        ).map(([reiksme, vardas]) => (
          <button key={reiksme} aria-pressed={skirtukas === reiksme} onClick={() => setSkirtukas(reiksme)}>
            {vardas}
          </button>
        ))}
      </div>

      {klaida && <p className="error">{klaida}</p>}

      {skirtukas === 'darbai' && (
        <>
          {grupes
            .filter((g) => g.etapas !== null || g.uzduotys.length > 0 || d.sections.length === 0)
            .map((g) => (
              <section key={g.etapas?.id ?? 'be'} className="kortele-sarasas uzd-grupe">
                <header>
                  <h2>{g.etapas?.name ?? (d.sections.length > 0 ? 'Kiti darbai' : 'Darbai')}</h2>
                  {g.etapas && (
                    <span className="projekto-etapo-veiksmai">
                      <button
                        className="ghost small"
                        aria-label={`Pervadinti etapą „${g.etapas.name}“`}
                        onClick={() => {
                          const name = prompt('Etapo pavadinimas', g.etapas!.name)?.trim()
                          if (name && name !== g.etapas!.name) void veiksmas(() => darbai.keistiEtapa(g.etapas!.id, { name }))
                        }}
                      >
                        ✎
                      </button>
                      <button
                        className="ghost small"
                        aria-label={`Ištrinti etapą „${g.etapas.name}“`}
                        onClick={() =>
                          confirm(`Ištrinti etapą „${g.etapas!.name}“? Jo darbai liks projekte.`) &&
                          void veiksmas(() => darbai.istrintiEtapa(g.etapas!.id))
                        }
                      >
                        ×
                      </button>
                    </span>
                  )}
                </header>
                {g.uzduotys.length > 0 && <ul className="uzd-sarasas">{g.uzduotys.map(eilute)}</ul>}
                <button className="linkish projekto-prideti" onClick={() => setAtidaryta({ naujaEtape: g.etapas?.id ?? null })}>
                  + Pridėti darbą
                </button>
              </section>
            ))}

          <form
            className="uzd-greitai"
            onSubmit={(e) => {
              e.preventDefault()
              const name = naujasEtapas.trim()
              if (!name) return
              setNaujasEtapas('')
              void veiksmas(() => darbai.sukurtiEtapa(p.id, name))
            }}
          >
            <input value={naujasEtapas} onChange={(e) => setNaujasEtapas(e.target.value)} placeholder="Naujas etapas, pvz., Dekoracijos" maxLength={80} />
            <button type="submit" disabled={!naujasEtapas.trim()}>
              + Etapas
            </button>
          </form>
        </>
      )}

      {skirtukas === 'biudzetas' && (
        <Biudzetas d={d} onEilute={setIslaida} onPakeista={load} />
      )}

      {skirtukas === 'info' && (
        <Info
          key={p.id}
          d={d}
          sritys={sritys}
          nariai={nariai}
          onIssaugoti={(laukai) => veiksmas(() => darbai.keistiProjekta(p.id, laukai))}
          onIstrinti={async () => {
            if (!confirm(`Ištrinti projektą „${p.title}“ su visais darbais? 30 dienų jį galėsite atkurti iš šiukšliadėžės.`)) return
            try {
              await darbai.istrintiProjekta(p.id)
              onAtgal()
            } catch (err) {
              setKlaida(klaidosTekstas(err))
            }
          }}
        />
      )}

      {atidaryta && (
        <UzduotiesDialogas
          uzduotis={'id' in atidaryta ? (d.tasks.find((t) => t.id === atidaryta.id) ?? atidaryta) : null}
          visos={d.tasks}
          sritys={sritys}
          numatytieji={'naujaEtape' in atidaryta ? { projectId: p.id, sectionId: atidaryta.naujaEtape, areaId: p.area_id } : undefined}
          onUzdaryti={() => setAtidaryta(null)}
          onPakeista={load}
        />
      )}

      {islaida && (
        <IslaidosDialogas
          projectId={p.id}
          islaida={islaida === 'nauja' ? null : islaida}
          darbai={d.tasks}
          onUzdaryti={() => setIslaida(null)}
          onPakeista={load}
        />
      )}

      <Zinute zinute={zinute} onUzdaryti={() => setZinute(null)} />
    </div>
  )
}

/** Biudžetas: eilutės (planas, faktas), sumos ir kiek liko. */
function Biudzetas({ d, onEilute, onPakeista }: { d: ProjektoDuomenys; onEilute: (c: Islaida | 'nauja') => void; onPakeista: () => void }) {
  const finansai = useModulis('finansai')
  const p = d.project
  const tikslas = biudzetoTikslas(p)
  const liko = tikslas !== null ? tikslas - p.actual_cents : null
  const yraIverciu = d.costs.some((c) => c.is_estimate === 1)
  const darboVardas = (id: number | null) => d.tasks.find((t) => t.id === id)?.title

  return (
    <section className="kortele-sarasas projekto-biudzetas">
      <div className="projekto-biudzeto-suvestine">
        <span>
          Biudžetas <b>{p.budget_cents !== null ? eur(p.budget_cents) : 'nenustatytas'}</b>
        </span>
        <span>
          Suplanuota <b>{eur(p.planned_cents)}</b>
        </span>
        <span>
          Išleista <b>{eur(p.actual_cents)}</b>
        </span>
        {liko !== null && (
          <span className={liko < 0 ? 'neigiama' : undefined}>
            {liko < 0 ? 'Viršyta' : 'Liko'} <b>{eur(Math.abs(liko))}</b>
          </span>
        )}
      </div>
      {p.budget_cents !== null && p.planned_cents > 0 && p.planned_cents !== p.budget_cents && (
        <p className="paaiskinimas">Eilučių planų suma ({eur(p.planned_cents)}) nesutampa su biudžetu ({eur(p.budget_cents)}).</p>
      )}

      {d.costs.length === 0 ? (
        <p className="tuscia">Biudžeto eilučių dar nėra.</p>
      ) : (
        <table className="projekto-lentele">
          <thead>
            <tr>
              <th />
              <th>Planas</th>
              <th>Faktas</th>
            </tr>
          </thead>
          <tbody>
            {d.costs.map((c) => (
              <tr key={c.id} onClick={() => onEilute(c)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onEilute(c)}>
                <td>
                  {c.name}
                  {darboVardas(c.task_id) && <small className="po-tekstu">↳ {darboVardas(c.task_id)}</small>}
                </td>
                <td>
                  {c.planned_cents !== null ? eur(c.planned_cents) : '—'}
                  {c.is_estimate === 1 && c.planned_cents !== null ? '*' : ''}
                </td>
                <td>
                  {c.actual_cents !== null ? eur(c.actual_cents) : '—'}
                  {(c.bank_links ?? 0) > 0 && <small className="po-tekstu">iš banko</small>}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Iš viso</td>
              <td>{eur(p.planned_cents)}</td>
              <td>{eur(p.actual_cents)}</td>
            </tr>
          </tfoot>
        </table>
      )}
      {yraIverciu && <p className="paaiskinimas">* įvertis (katinuko ar šablono) — pataisykite, kai žinosite tikrą kainą.</p>}
      <button className="small projekto-prideti-eilute" onClick={() => onEilute('nauja')}>
        + Eilutė
      </button>
      {finansai && <ProjektoBankas projectId={p.id} eilutes={d.costs} onPakeista={onPakeista} />}
    </section>
  )
}

/** Projekto informacija: pavadinimas, tikslas, data, biudžetas, atsakingas, sritis, būsena. */
function Info({
  d,
  sritys,
  nariai,
  onIssaugoti,
  onIstrinti,
}: {
  d: ProjektoDuomenys
  sritys: Sritis[]
  nariai: { id: number; name: string; uses_app: number }[]
  onIssaugoti: (laukai: Parameters<typeof darbai.keistiProjekta>[1]) => Promise<void>
  onIstrinti: () => void
}) {
  const p = d.project
  const [pavadinimas, setPavadinimas] = useState(p.title)
  const [tikslas, setTikslas] = useState(p.goal ?? '')
  const [data, setData] = useState(p.target_date ?? '')
  const [biudzetas, setBiudzetas] = useState(eurai(p.budget_cents))
  const [atsakingas, setAtsakingas] = useState<number | null>(p.owner_id)
  const [sritis, setSritis] = useState<number | null>(p.area_id)
  const [pastabos, setPastabos] = useState(p.notes ?? '')
  const [busena, setBusena] = useState<ProjektoBusena>(p.status)
  const finansai = useModulis('finansai')
  const [katiliukas, setKatiliukas] = useState<number | null>(p.savings_goal_id)
  const [katiliukai, setKatiliukai] = useState<{ id: number; name: string; owner: string }[]>([])
  const [klaida, setKlaida] = useState<string | null>(null)
  const [issaugota, setIssaugota] = useState(false)

  useEffect(() => {
    darbai
      .katiliukai()
      .then(setKatiliukai)
      .catch(() => setKatiliukai([]))
  }, [])

  async function issaugoti() {
    const centai = sumaCentais(biudzetas)
    if (!pavadinimas.trim()) return setKlaida('Projektui reikia pavadinimo.')
    if (Number.isNaN(centai)) return setKlaida('Netinkamas biudžetas — rašyk, pvz., 500.')
    setKlaida(null)
    await onIssaugoti({
      title: pavadinimas,
      goal: tikslas.trim() || null,
      targetDate: data || null,
      budgetCents: centai,
      ownerId: atsakingas,
      areaId: sritis,
      notes: pastabos.trim() || null,
      status: busena,
      savingsGoalId: katiliukas,
    })
    setIssaugota(true)
  }

  return (
    <section className="kortele-sarasas projekto-info">
      <label>
        Pavadinimas
        <input value={pavadinimas} onChange={(e) => setPavadinimas(e.target.value)} maxLength={120} />
      </label>
      <label>
        Tikslas, trumpai
        <input value={tikslas} onChange={(e) => setTikslas(e.target.value)} placeholder="pvz., žaidimų kambaryje, ~15 vaikų" maxLength={1000} />
      </label>
      <div className="uzd-du-laukai">
        <label>
          Data
          <input type="date" value={data} onChange={(e) => setData(e.target.value)} />
        </label>
        <label>
          Biudžetas, €
          <input inputMode="decimal" value={biudzetas} onChange={(e) => setBiudzetas(e.target.value)} />
        </label>
      </div>
      <div className="uzd-du-laukai">
        <label>
          Atsakingas
          <select value={atsakingas ?? ''} onChange={(e) => setAtsakingas(e.target.value ? Number(e.target.value) : null)}>
            <option value="">—</option>
            {nariai
              .filter((n) => n.uses_app)
              .map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Sritis
          <select value={sritis ?? ''} onChange={(e) => setSritis(e.target.value ? Number(e.target.value) : null)}>
            <option value="">— be srities —</option>
            {sritys.map((s) => (
              <option key={s.id} value={s.id}>
                {s.icon} {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Pastabos
        <textarea value={pastabos} onChange={(e) => setPastabos(e.target.value)} rows={3} maxLength={5000} />
      </label>
      {finansai && katiliukai.length > 0 && (
        <label>
          Taupymo katiliukas (kiek sukaupta — rodoma viršuje)
          <select value={katiliukas ?? ''} onChange={(e) => setKatiliukas(e.target.value ? Number(e.target.value) : null)}>
            <option value="">— nesusieta —</option>
            {katiliukai.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name} ({k.owner})
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="perjungiklis" role="group" aria-label="Būsena">
        {BUSENOS.map((b) => (
          <button key={b.reiksme} type="button" aria-pressed={busena === b.reiksme} onClick={() => setBusena(b.reiksme)}>
            {b.vardas}
          </button>
        ))}
      </div>
      {klaida && <p className="error">{klaida}</p>}
      {issaugota && <p className="pranesimai-zinia">Išsaugota ✓</p>}
      <div className="modal-mygtukai">
        <button className="ghost uzd-trinti" onClick={onIstrinti}>
          Ištrinti projektą
        </button>
        <button onClick={() => void issaugoti()}>Išsaugoti</button>
      </div>
    </section>
  )
}
