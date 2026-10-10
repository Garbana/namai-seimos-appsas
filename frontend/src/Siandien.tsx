import { useEffect, useMemo, useState } from 'react'
import { api, eur, menuoVardas, type Priminimai as PriminimuDuomenys } from './api'
import { darbai, type Projektas, type Uzduotis } from './darbai/api'
import { pilnaData, pridetiDienu, siandien } from './darbai/datos'
import { darbuZodis, pagalTermina } from './darbai/tvarka'
import RuososDialogas from './darbai/RuososDialogas'
import UzduotiesDialogas from './darbai/UzduotiesDialogas'
import ProjektoKortele from './darbai/ProjektoKortele'
import UzduotiesEilute from './darbai/UzduotiesEilute'
import { useUzduotys } from './darbai/useUzduotys'
import { kopijuProblema } from './kopijos'
import { palaikoma, sioPrenumerata, telefonas } from './prenumerata'
import PriminimuBlokas from './Priminimai'
import { useModulis } from './nustatymai'
import { kalendorius, type Ivykis } from './kalendorius/api'
import { useNariai } from './darbai/nariai'
import Zinute from './Zinute'

type Props = {
  onEiti: (skiltis: 'uzduotys' | 'pirkiniai' | 'finansai' | 'kopijos' | 'pranesimai' | 'kalendorius') => void
  onAtidarytiProjekta: (p: Projektas) => void
}

type Finansai = { menuo: string; islaidos: number; nesumoketa: string[] }

/** Kiek artimiausių darbų rodyti iškart; kiti — paspaudus „rodyti visus“. */
const ARTIMIAUSI = 5

/**
 * Pirmas ekranas: ką daryti šiandien, kas vėluoja, kas artėja, ir trumpai — pirkiniai
 * bei mėnesio pinigai. Viskas iš jau esamų API; čia nieko naujo nesaugoma.
 */
export default function Siandien({ onEiti, onAtidarytiProjekta }: Props) {
  const { uzduotys, sritys, klaida, load, atlikti, zinute, setZinute } = useUzduotys()
  const [atidaryta, setAtidaryta] = useState<Uzduotis | 'nauja' | null>(null)
  const [pirkti, setPirkti] = useState<number | null>(null)
  const [finansai, setFinansai] = useState<Finansai | null>(null)
  // Reguliarūs mokėjimai — jei kas dar nesumokėta, rodoma ir čia (7 etapas).
  const [mokejimai, setMokejimai] = useState<PriminimuDuomenys | null>(null)
  // Kalendorius: šiandienos ir rytojaus įvykiai.
  const [ivykiai, setIvykiai] = useState<Ivykis[]>([])
  const { nariai } = useNariai()
  const finansuModulis = useModulis('finansai')
  const [kopijos, setKopijos] = useState<string | null>(null)
  const [visiArtimiausi, setVisiArtimiausi] = useState(false)
  const [siulytiPranesimus, setSiulytiPranesimus] = useState(false)
  const [projektai, setProjektai] = useState<Projektas[]>([])
  const siandiena = siandien()

  // Papildoma informacija: jei kuri nepasikrauna, ekranas vis tiek veikia.
  useEffect(() => {
    darbai
      .projektai()
      .then((ps) => setProjektai(ps.filter((p) => p.status === 'aktyvus')))
      .catch(() => setProjektai([]))
    const diena = siandien()
    kalendorius
      .intervalas(diena, pridetiDienu(diena, 1))
      .then((d) => setIvykiai(d.ivykiai))
      .catch(() => setIvykiai([]))
    darbai
      .pirkiniai()
      .then((d) => setPirkti(d.items.filter((p) => !p.checked_at).length))
      .catch(() => setPirkti(null))
    if (finansuModulis) Promise.all([api.overview(), api.reminders()])
      .then(([apzvalga, priminimai]) => {
        setMokejimai(priminimai)
        const menuo = apzvalga.months.at(-1)?.month
        if (!menuo) return
        const islaidos = apzvalga.cells
          .filter((c) => c.month === menuo && c.side === 'expense')
          .reduce((s, c) => s + Math.abs(c.amount), 0)
        const nesumoketa = priminimai.items
          .filter((i) => i.source !== 'taupymas' && i.state !== 'sumoketa')
          .map((i) => i.name)
        setFinansai({ menuo, islaidos, nesumoketa })
      })
      .catch(() => setFinansai(null))
    api
      .backups()
      .then((d) => setKopijos(kopijuProblema(d)))
      .catch(() => setKopijos(null))
    // Telefone, kuriame dar nebuvo klausta leidimo, — pasiūlom įjungti pranešimus.
    if (palaikoma() && telefonas() && Notification.permission === 'default') {
      sioPrenumerata()
        .then((sub) => setSiulytiPranesimus(!sub))
        .catch(() => setSiulytiPranesimus(false))
    }
  }, [finansuModulis])

  const visos = useMemo(() => uzduotys ?? [], [uzduotys])
  const atviros = useMemo(
    () => visos.filter((u) => u.parent_id === null && u.status === 'atvira' && u.due_date).sort(pagalTermina),
    [visos]
  )
  const savaitesGalas = pridetiDienu(siandiena, 7)
  const veluoja = atviros.filter((u) => u.due_date! < siandiena)
  const siandien_ = atviros.filter((u) => u.due_date === siandiena)
  const artimiausi = atviros.filter((u) => u.due_date! > siandiena && u.due_date! <= savaitesGalas)

  const eilute = (u: Uzduotis) => (
    <UzduotiesEilute
      key={u.id}
      uzduotis={u}
      visos={visos}
      sritys={sritys}
      siandiena={siandiena}
      rodytiSriti
      projektas={projektai.find((p) => p.id === u.project_id)?.title}
      onAtlikti={atlikti}
      onAtidaryti={setAtidaryta}
    />
  )

  const skiltis = (pavadinimas: string, sarasas: Uzduotis[], klase = '') => (
    <section className={`kortele-sarasas uzd-grupe ${klase}`}>
      <header>
        <h2>{pavadinimas}</h2>
        <span className="paaiskinimas">{darbuZodis(sarasas.length)}</span>
      </header>
      <ul className="uzd-sarasas">{sarasas.map(eilute)}</ul>
    </section>
  )

  return (
    <div className="siandien">
      <div className="siandien-virsus">
        <p className="siandien-data">{pilnaData(siandiena).replace(/^./, (r) => r.toUpperCase())}</p>
        <button className="small" onClick={() => setAtidaryta('nauja')}>
          + Užduotis
        </button>
      </div>

      {kopijos && (
        <button className="izvalga svarbi" onClick={() => onEiti('kopijos')}>
          <span className="zenklas" aria-hidden="true">
            !
          </span>
          <span>
            <b>Atsarginės kopijos</b>
            <small>{kopijos}</small>
          </span>
        </button>
      )}

      {siulytiPranesimus && (
        <button className="izvalga" onClick={() => onEiti('pranesimai')}>
          <span className="zenklas" aria-hidden="true">
            ◔
          </span>
          <span>
            <b>Įjunk pranešimus šiame telefone</b>
            <small>Rytinė suvestinė ir priminimai — net neatsidarius appso</small>
          </span>
        </button>
      )}

      {ivykiai.length > 0 && (
        <section className="kortele-sarasas siandien-ivykiai">
          <header>
            <h2>Kalendoriuje</h2>
            <button className="linkish" onClick={() => onEiti('kalendorius')}>
              kalendorius →
            </button>
          </header>
          <ul className="kal-sarasas">
            {ivykiai.map((e) => {
              const vienas = e.members.length === 1 ? nariai.find((n) => n.id === e.members[0]) : undefined
              const rytoj = e.start_date > siandiena
              return (
                <li key={`${e.id}-${e.start_date}`}>
                  <button className="kal-ivykis" style={{ borderLeftColor: vienas?.color ?? 'var(--pirmine)' }} onClick={() => onEiti('kalendorius')}>
                    <span className="kal-laikas">{e.start_time ?? 'visą d.'}</span>
                    <span className="kal-tekstas">
                      <b>{e.title}</b>
                      <small>
                        {[rytoj ? 'rytoj' : null, e.members.map((m) => nariai.find((n) => n.id === m)?.name).filter(Boolean).join(', '), e.location]
                          .filter(Boolean)
                          .join(' · ')}
                      </small>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {klaida && <p className="error">{klaida}</p>}
      {!uzduotys && !klaida && <p className="paaiskinimas">Kraunama…</p>}

      {veluoja.length > 0 && skiltis('Vėluoja', veluoja, 'veluoja-grupe')}
      {uzduotys &&
        (siandien_.length > 0 ? (
          skiltis('Šiandien', siandien_)
        ) : (
          <section className="kortele-sarasas">
            <p className="tuscia siandien-tuscia">
              {veluoja.length > 0 ? 'Šiandienai daugiau nieko nesuplanuota.' : 'Šiandien darbų nėra ✓'}
            </p>
          </section>
        ))}

      {artimiausi.length > 0 && (
        <section className="kortele-sarasas uzd-grupe">
          <header>
            <h2>Artimiausios 7 dienos</h2>
            <span className="paaiskinimas">{darbuZodis(artimiausi.length)}</span>
          </header>
          <ul className="uzd-sarasas">{(visiArtimiausi ? artimiausi : artimiausi.slice(0, ARTIMIAUSI)).map(eilute)}</ul>
          {artimiausi.length > ARTIMIAUSI && (
            <button className="linkish" onClick={() => setVisiArtimiausi(!visiArtimiausi)}>
              {visiArtimiausi ? 'rodyti mažiau' : `rodyti visus (${artimiausi.length})`}
            </button>
          )}
        </section>
      )}

      {mokejimai && mokejimai.items.some((i) => i.source !== 'taupymas' && i.state !== 'sumoketa') && (
        <PriminimuBlokas
          duomenys={mokejimai}
          onChanged={() =>
            api
              .reminders()
              .then(setMokejimai)
              .catch(() => setMokejimai(null))
          }
        />
      )}

      {projektai.length > 0 && (
        <div className="projektu-sarasas">
          {projektai.map((p) => (
            <ProjektoKortele key={p.id} projektas={p} siandiena={siandiena} onClick={() => onAtidarytiProjekta(p)} />
          ))}
        </div>
      )}

      <div className="siandien-korteles">
        <button className="izvalga" onClick={() => onEiti('uzduotys')}>
          <span className="zenklas" aria-hidden="true">
            ✓
          </span>
          <span>
            <b>Visos užduotys</b>
            <small>{uzduotys ? darbuZodis(visos.filter((u) => u.parent_id === null && !u.chore && u.status === 'atvira').length) : '…'}</small>
          </span>
        </button>
        <button className="izvalga" onClick={() => onEiti('pirkiniai')}>
          <span className="zenklas" aria-hidden="true">
            □
          </span>
          <span>
            <b>Pirkiniai</b>
            <small>{pirkti === null ? '…' : pirkti === 0 ? 'nieko nereikia' : `${pirkti} prek.`}</small>
          </span>
        </button>
        {finansai && (
          <button className="izvalga" onClick={() => onEiti('finansai')}>
            <span className="zenklas" aria-hidden="true">
              €
            </span>
            <span>
              <b>
                {menuoVardas(finansai.menuo)}: išleista {eur(finansai.islaidos)}
              </b>
              <small>
                {finansai.nesumoketa.length === 0
                  ? 'visi reguliarūs mokėjimai atlikti'
                  : `nesumokėta: ${finansai.nesumoketa.slice(0, 3).join(', ')}${finansai.nesumoketa.length > 3 ? '…' : ''}`}
              </small>
            </span>
          </button>
        )}
      </div>

      {atidaryta && atidaryta !== 'nauja' && atidaryta.chore === 1 && (
        <RuososDialogas ruosa={visos.find((u) => u.id === atidaryta.id) ?? atidaryta} sritys={sritys} onUzdaryti={() => setAtidaryta(null)} onPakeista={load} />
      )}
      {atidaryta && (atidaryta === 'nauja' || atidaryta.chore !== 1) && (
        <UzduotiesDialogas
          uzduotis={atidaryta === 'nauja' ? null : (visos.find((u) => u.id === atidaryta.id) ?? atidaryta)}
          visos={visos}
          sritys={sritys}
          numatytieji={{ dueDate: siandiena }}
          onUzdaryti={() => setAtidaryta(null)}
          onPakeista={load}
        />
      )}

      <Zinute zinute={zinute} onUzdaryti={() => setZinute(null)} />
    </div>
  )
}
