import { useCallback, useEffect, useMemo, useState } from 'react'
import Zinute from '../Zinute'
import { useZinute } from '../useZinute'
import { darbai, type Sritis, type Uzduotis } from '../darbai/api'
import { DIENU_RAIDES, pilnaData, pridetiDienu, savaitesDiena, siandien } from '../darbai/datos'
import { useNariai } from '../darbai/nariai'
import UzduotiesDialogas from '../darbai/UzduotiesDialogas'
import { kalendorius, type Ivykis, type KalendoriausDuomenys, type KalendoriausUzduotis } from './api'
import IvykioDialogas from './IvykioDialogas'
import { useModulis } from '../nustatymai'

type Vaizdas = 'menuo' | 'sarasas'

const MENESIAI = ['Sausis', 'Vasaris', 'Kovas', 'Balandis', 'Gegužė', 'Birželis', 'Liepa', 'Rugpjūtis', 'Rugsėjis', 'Spalis', 'Lapkritis', 'Gruodis']

const klaidosTekstas = (err: unknown) => (err instanceof Error ? err.message : 'Nepavyko.')

function skaitytiVaizda(): Vaizdas {
  try {
    return localStorage.getItem('kalendoriaus-vaizdas') === 'menuo' ? 'menuo' : 'sarasas'
  } catch {
    return 'sarasas'
  }
}

/** Mėnesio tinklelis: nuo pirmadienio prieš 1 d. iki sekmadienio po paskutinės. */
function tinklelis(menuo: string): { nuo: string; iki: string; dienos: string[] } {
  const pirma = `${menuo}-01`
  const nuo = pridetiDienu(pirma, -savaitesDiena(pirma))
  const [y, m] = menuo.split('-').map(Number)
  const paskutine = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
  const iki = pridetiDienu(paskutine, 6 - savaitesDiena(paskutine))
  const dienos: string[] = []
  for (let d = nuo; d <= iki; d = pridetiDienu(d, 1)) dienos.push(d)
  return { nuo, iki, dienos }
}

const kitasMenuo = (menuo: string, n: number) => {
  const [y, m] = menuo.split('-').map(Number)
  const t = y * 12 + (m - 1) + n
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
}

/** Ar įvykis vyksta tą dieną (keliadieniai — kiekvieną savo dieną). */
const vyksta = (e: Ivykis, d: string) => e.start_date <= d && e.end_date >= d

/**
 * Šeimos kalendorius: įvykiai (vizitai, repeticijos, būreliai…) ir užduočių terminai. Sąrašas —
 * dienomis nuo šiandien, mėnuo — tinklelis su taškeliais; filtras — kieno. Sinchronizuojasi su
 * šeimos Google kalendoriumi (Daugiau → Google kalendorius).
 */
export default function Kalendorius({ onGoogle }: { onGoogle: () => void }) {
  const { nariai } = useNariai()
  const siandiena = siandien()
  const [vaizdas, setVaizdas] = useState<Vaizdas>(skaitytiVaizda)
  const [menuo, setMenuo] = useState(siandiena.slice(0, 7))
  const [pasirinkta, setPasirinkta] = useState(siandiena)
  const [kieno, setKieno] = useState<number | null>(null)
  const [d, setD] = useState<KalendoriausDuomenys | null>(null)
  const [klaida, setKlaida] = useState<string | null>(null)
  const [atidarytas, setAtidarytas] = useState<Ivykis | { naujas: string } | null>(null)
  const [uzduotis, setUzduotis] = useState<{ u: Uzduotis; visos: Uzduotis[] } | null>(null)
  const [sritys, setSritys] = useState<Sritis[]>([])
  const [zinute, setZinute] = useZinute()
  const google = useModulis('google')

  const grid = useMemo(() => tinklelis(menuo), [menuo])
  // Sąrašas — nuo šiandien (ar mėnesio pradžios, jei žiūrima kitą mėnesį) iki mėnesio galo.
  const sarasoNuo = menuo === siandiena.slice(0, 7) ? siandiena : `${menuo}-01`
  const nuo = vaizdas === 'menuo' ? grid.nuo : sarasoNuo
  const iki = vaizdas === 'menuo' ? grid.iki : pridetiDienu(`${kitasMenuo(menuo, 1)}-01`, -1)

  const load = useCallback(() => {
    kalendorius
      .intervalas(nuo, iki)
      .then((x) => {
        setD(x)
        setKlaida(null)
      })
      .catch((err) => setKlaida(klaidosTekstas(err)))
  }, [nuo, iki])

  useEffect(() => load(), [load])
  useEffect(() => {
    darbai
      .sritys()
      .then(setSritys)
      .catch(() => setSritys([]))
  }, [])

  function keistiVaizda(v: Vaizdas) {
    setVaizdas(v)
    try {
      localStorage.setItem('kalendoriaus-vaizdas', v)
    } catch {
      // Neįsimins — nieko baisaus.
    }
  }

  const tinka = (members: number[]) => kieno === null || members.length === 0 || members.includes(kieno)
  const ivykiai = (d?.ivykiai ?? []).filter((e) => tinka(e.members))
  const uzduotys = (d?.uzduotys ?? []).filter((u) => kieno === null || u.assignee_id === null || u.assignee_id === kieno)
  const spalva = (members: number[]) => (members.length === 1 ? nariai.find((n) => n.id === members[0])?.color : undefined)
  const vardai = (members: number[]) => members.map((m) => nariai.find((n) => n.id === m)?.name).filter(Boolean).join(', ')

  async function atidarytiUzduoti(u: KalendoriausUzduotis) {
    try {
      const visos = await darbai.uzduotys()
      const rasta = visos.find((x) => x.id === u.id)
      if (rasta) setUzduotis({ u: rasta, visos })
    } catch (err) {
      setKlaida(klaidosTekstas(err))
    }
  }

  const ivykioEilute = (e: Ivykis, diena: string) => (
    <li key={`e${e.id}-${e.start_date}`}>
      <button className="kal-ivykis" onClick={() => setAtidarytas(e)} style={{ borderLeftColor: spalva(e.members) ?? 'var(--pirmine)' }}>
        <span className="kal-laikas">
          {e.start_time === null || (e.start_date < diena && e.end_date > diena) ? 'visą d.' : e.start_date === diena ? e.start_time : `iki ${e.end_time}`}
        </span>
        <span className="kal-tekstas">
          <b>
            {e.title}
            {e.series && <span aria-label="pasikartoja"> ↻</span>}
            {e.sync_state === 'klaida' && <span title={e.sync_error ?? ''}> ⚠</span>}
          </b>
          {(e.members.length > 0 || e.location) && (
            <small>{[vardai(e.members), e.location].filter(Boolean).join(' · ')}</small>
          )}
        </span>
      </button>
    </li>
  )

  const uzduotiesEilute = (u: KalendoriausUzduotis) => (
    <li key={`u${u.id}`}>
      <button className="kal-ivykis kal-uzduotis" onClick={() => void atidarytiUzduoti(u)}>
        <span className="kal-laikas">{u.due_time ?? '✓'}</span>
        <span className="kal-tekstas">
          <b>{u.title}</b>
          <small>{[u.chore ? 'ruoša' : 'užduotis', nariai.find((n) => n.id === u.assignee_id)?.name].filter(Boolean).join(' · ')}</small>
        </span>
      </button>
    </li>
  )

  const diena = (data: string) => {
    const dienos = ivykiai.filter((e) => vyksta(e, data))
    const darbuDienos = uzduotys.filter((u) => u.due_date === data)
    return { dienos, darbuDienos }
  }

  const dienosSarasas = (data: string, rodytiTuscia = false) => {
    const { dienos, darbuDienos } = diena(data)
    if (!rodytiTuscia && dienos.length + darbuDienos.length === 0) return null
    return (
      <section key={data} className={`kal-diena${data === siandiena ? ' siandien' : ''}`}>
        <header>
          <h3>{pilnaData(data).replace(/^./, (r) => r.toUpperCase())}</h3>
          {data === siandiena && <span className="kal-zyme">šiandien</span>}
          <button className="ghost small" onClick={() => setAtidarytas({ naujas: data })} aria-label={`Naujas įvykis ${data}`}>
            +
          </button>
        </header>
        {dienos.length + darbuDienos.length === 0 ? (
          <p className="tuscia">Nieko nesuplanuota.</p>
        ) : (
          <ul className="kal-sarasas">
            {dienos.map((e) => ivykioEilute(e, data))}
            {darbuDienos.map(uzduotiesEilute)}
          </ul>
        )}
      </section>
    )
  }

  const sarasoDienos: string[] = []
  for (let x = nuo; x <= iki; x = pridetiDienu(x, 1)) sarasoDienos.push(x)
  const sarasas = sarasoDienos.map((x) => dienosSarasas(x)).filter(Boolean)

  return (
    <div className="kalendorius">
      <div className="kal-virsus">
        <div className="kal-menuo">
          <button className="ghost small" onClick={() => setMenuo(kitasMenuo(menuo, -1))} aria-label="Ankstesnis mėnuo">
            ‹
          </button>
          <b>
            {MENESIAI[Number(menuo.slice(5, 7)) - 1]} {menuo.slice(0, 4)}
          </b>
          <button className="ghost small" onClick={() => setMenuo(kitasMenuo(menuo, 1))} aria-label="Kitas mėnuo">
            ›
          </button>
          {menuo !== siandiena.slice(0, 7) && (
            <button
              className="ghost small"
              onClick={() => {
                setMenuo(siandiena.slice(0, 7))
                setPasirinkta(siandiena)
              }}
            >
              Šiandien
            </button>
          )}
        </div>
        <button onClick={() => setAtidarytas({ naujas: vaizdas === 'menuo' ? pasirinkta : siandiena })}>+ Įvykis</button>
      </div>

      <div className="kal-valdikliai">
        <div className="perjungiklis" role="group" aria-label="Vaizdas">
          <button aria-pressed={vaizdas === 'sarasas'} onClick={() => keistiVaizda('sarasas')}>
            Sąrašas
          </button>
          <button aria-pressed={vaizdas === 'menuo'} onClick={() => keistiVaizda('menuo')}>
            Mėnuo
          </button>
        </div>
        <div className="perjungiklis" role="group" aria-label="Kieno">
          <button aria-pressed={kieno === null} onClick={() => setKieno(null)}>
            Visi
          </button>
          {nariai.map((n) => (
            <button key={n.id} aria-pressed={kieno === n.id} onClick={() => setKieno(n.id)}>
              <span className="kal-taskas" style={{ background: n.color }} aria-hidden="true" />
              {n.name}
            </button>
          ))}
        </div>
      </div>

      {d && google && !d.google.prijungta && (
        <button className="linkish kal-google" onClick={onGoogle}>
          Google kalendorius dar neprijungtas — prijungti →
        </button>
      )}
      {d && d.google.prijungta && (d.google.klaida || d.google.nesinchronizuota > 0) && (
        <button className="linkish kal-google klaida" onClick={onGoogle}>
          ⚠ Google kalendorius: {d.google.klaida ?? `nesinchronizuota ${d.google.nesinchronizuota}`} →
        </button>
      )}

      {klaida && <p className="error">{klaida}</p>}
      {!d && !klaida && <p className="paaiskinimas">Kraunama…</p>}

      {d && vaizdas === 'menuo' && (
        <>
          <div className="kal-tinklelis" role="grid" aria-label="Mėnuo">
            {DIENU_RAIDES.map((r) => (
              <span key={r} className="kal-savaites-diena" role="columnheader">
                {r}
              </span>
            ))}
            {grid.dienos.map((x) => {
              const { dienos, darbuDienos } = diena(x)
              const kiti = x.slice(0, 7) !== menuo
              return (
                <button
                  key={x}
                  role="gridcell"
                  className={['kal-langelis', kiti ? 'kitas' : '', x === siandiena ? 'siandien' : '', x === pasirinkta ? 'pasirinkta' : ''].filter(Boolean).join(' ')}
                  onClick={() => setPasirinkta(x)}
                  aria-label={`${pilnaData(x)}: ${dienos.length} įvyk., ${darbuDienos.length} užd.`}
                >
                  <span className="kal-skaicius">{Number(x.slice(8, 10))}</span>
                  <span className="kal-zymes">
                    {dienos.slice(0, 3).map((e) => (
                      <span key={`${e.id}-${e.start_date}`} className="kal-juostele" style={{ background: spalva(e.members) ?? 'var(--pirmine)' }} />
                    ))}
                    {darbuDienos.length > 0 && <span className="kal-juostele uzduotis" />}
                    {dienos.length > 3 && <span className="kal-daugiau">+{dienos.length - 3}</span>}
                  </span>
                </button>
              )
            })}
          </div>
          {dienosSarasas(pasirinkta, true)}
        </>
      )}

      {d && vaizdas === 'sarasas' && (sarasas.length > 0 ? sarasas : <p className="tuscia">Šį mėnesį daugiau nieko nesuplanuota.</p>)}

      {atidarytas && (
        <IvykioDialogas
          ivykis={'naujas' in atidarytas ? null : atidarytas}
          data={'naujas' in atidarytas ? atidarytas.naujas : undefined}
          googleKalendorius={d?.google.kalendorius}
          onUzdaryti={() => setAtidarytas(null)}
          onPakeista={(z) => {
            load()
            if (z) setZinute({ tekstas: z.tekstas, veiksmas: z.atsaukti ? { pavadinimas: 'Atšaukti', atlikti: z.atsaukti } : undefined })
          }}
        />
      )}

      {uzduotis && (
        <UzduotiesDialogas uzduotis={uzduotis.u} visos={uzduotis.visos} sritys={sritys} onUzdaryti={() => setUzduotis(null)} onPakeista={load} />
      )}

      <Zinute zinute={zinute} onUzdaryti={() => setZinute(null)} />
    </div>
  )
}
