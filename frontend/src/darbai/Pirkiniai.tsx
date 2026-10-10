import { useCallback, useEffect, useRef, useState } from 'react'
import { darbai, type Preke } from './api'
import { inicialai } from './datos'
import { useNariai } from './nariai'
import {
  eile,
  iEile,
  ismestiLaikina,
  rasytiKesa,
  rysioKlaida,
  siustiEile,
  skaitytiKesa,
  suLaiku,
  type EilesVeiksmas,
  type PirkiniuDuomenys,
} from './pirkiniuEile'

/** Kas kiek perkrauti, kol ekranas atidarytas — kad matytum, ką pridėjo kitas. */
const ATNAUJINIMAS_MS = 20_000

const klaidosTekstas = (err: unknown) => (err instanceof Error ? err.message : 'Nepavyko.')

function skaitytiSarasa(): number | null {
  try {
    return Number(localStorage.getItem('pirkiniu-sarasas')) || null
  } catch {
    return null
  }
}

/**
 * Pirkinių sąrašas: bakstelėjus — nupirkta, „Nupirkta“ dalyje — grąžinti. Prekės sugrupuotos
 * pagal parduotuvės skyrius; viršuje — „Gal reikia?“ (dažnai perkamos). Be ryšio sąrašas
 * imamas iš telefono, o pakeitimai išsiunčiami atsiradus ryšiui (pirkiniuEile.ts).
 */
export default function Pirkiniai({ fokusuoti = false }: { fokusuoti?: boolean }) {
  const { nariai, as } = useNariai()
  // Iškart — telefone išsaugotas sąrašas (parduotuvėje ryšys lėtas), tada atnaujinam iš serverio.
  const [duomenys, setDuomenys] = useState<PirkiniuDuomenys | null>(skaitytiKesa)
  const [pasirinktas, setPasirinktas] = useState<number | null>(skaitytiSarasa)
  const [pavadinimas, setPavadinimas] = useState('')
  const [kiekis, setKiekis] = useState('')
  const [klaida, setKlaida] = useState<string | null>(null)
  const [rodytiNupirktas, setRodytiNupirktas] = useState(false)
  const [tvarkyti, setTvarkyti] = useState(false)
  const [beRysio, setBeRysio] = useState(false)
  const [laukia, setLaukia] = useState(() => eile().length)

  /** Būsena ekrane ir telefone — kad be ryšio matytum tą patį. */
  const keisti = useCallback((f: (d: PirkiniuDuomenys) => PirkiniuDuomenys) => {
    setDuomenys((d) => {
      if (!d) return d
      const naujas = f(d)
      rasytiKesa(naujas)
      return naujas
    })
  }, [])

  // Užklausos gali grįžti ne iš eilės (lėtas ryšys parduotuvėje): taikom tik naujausią,
  // kad senas atsakymas neuždengtų ką tik pažymėtos prekės.
  const naujausia = useRef(0)
  const load = useCallback(() => {
    const nr = ++naujausia.current
    return siustiEile(as)
      .then(() => suLaiku(darbai.pirkiniai()))
      .then((d) => {
        if (nr !== naujausia.current) return
        setDuomenys(d)
        rasytiKesa(d)
        setBeRysio(false)
      })
      .catch((err) => {
        if (rysioKlaida(err)) {
          setBeRysio(true)
          setDuomenys((d) => d ?? skaitytiKesa())
        } else {
          setKlaida(klaidosTekstas(err))
        }
      })
      .finally(() => setLaukia(eile().length))
  }, [as])

  useEffect(() => {
    void load()
    const laikmatis = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, ATNAUJINIMAS_MS)
    const atnaujinti = () => void load()
    window.addEventListener('focus', atnaujinti)
    window.addEventListener('online', atnaujinti)
    return () => {
      clearInterval(laikmatis)
      window.removeEventListener('focus', atnaujinti)
      window.removeEventListener('online', atnaujinti)
    }
  }, [load])

  const sarasai = duomenys?.lists ?? []
  const aktyvus = sarasai.some((s) => s.id === pasirinktas) ? pasirinktas : (sarasai[0]?.id ?? null)
  const prekes = (duomenys?.items ?? []).filter((p) => p.list_id === aktyvus)
  const pirkti = prekes.filter((p) => !p.checked_at)
  const nupirkta = prekes.filter((p) => p.checked_at)
  const kiekNepirkta = (id: number) => (duomenys?.items ?? []).filter((p) => p.list_id === id && !p.checked_at).length
  const skyriai = duomenys?.sections ?? []
  const pasiulymai = (duomenys?.suggestions ?? []).filter((s) => s.list_id === aktyvus)

  // Skyriai parduotuvės tvarka; antraštės — tik kai prekės keliuose skyriuose.
  const pagalSkyriu = skyriai
    .map((s) => ({ skyrius: s, prekes: pirkti.filter((p) => (p.section ?? 'Kita') === s) }))
    .filter((g) => g.prekes.length > 0)
  const be = pirkti.filter((p) => !skyriai.includes(p.section ?? 'Kita'))
  if (be.length > 0) pagalSkyriu.push({ skyrius: 'Kita', prekes: be })

  function rinktisSarasa(id: number) {
    setPasirinktas(id)
    try {
      localStorage.setItem('pirkiniu-sarasas', String(id))
    } catch {
      // Neįsimins — nieko baisaus.
    }
  }

  /** Veiksmas serveriui; be ryšio — į eilę (išsiųs vėliau). */
  async function siusti(veiksmas: EilesVeiksmas, darbas: () => Promise<unknown>) {
    setKlaida(null)
    if (eile().length > 0 || veiksmas.id < 0) {
      // Eilė dar neišsiųsta — kad išliktų tvarka, šis veiksmas eina į jos galą.
      iEile(veiksmas)
      setLaukia(eile().length)
      void load()
      return
    }
    try {
      await suLaiku(darbas())
      void load()
    } catch (err) {
      if (rysioKlaida(err)) {
        iEile(veiksmas)
        setLaukia(eile().length)
        setBeRysio(true)
      } else {
        setKlaida(klaidosTekstas(err))
        void load()
      }
    }
  }

  async function prideti(name: string, quantity: string | null) {
    if (!name || aktyvus === null) return
    const laikinas: Preke = {
      id: -Date.now(),
      list_id: aktyvus,
      name,
      quantity,
      added_by: as,
      added_at: new Date().toISOString(),
      checked_at: null,
      checked_by: null,
      section: null,
    }
    keisti((d) => ({
      ...d,
      items: [laikinas, ...d.items.filter((x) => !(x.list_id === aktyvus && x.name.toLocaleLowerCase('lt') === name.toLocaleLowerCase('lt')))],
      suggestions: d.suggestions.filter((s) => !(s.list_id === aktyvus && s.name.toLocaleLowerCase('lt') === name.toLocaleLowerCase('lt'))),
    }))
    await siusti({ tipas: 'prideti', id: laikinas.id, listId: aktyvus, name, quantity }, () =>
      darbai.pridetiPreke({ listId: aktyvus, name, quantity }, as)
    )
  }

  function pridetiIsFormos() {
    const name = pavadinimas.trim()
    if (!name) return
    setPavadinimas('')
    setKiekis('')
    void prideti(name, kiekis.trim() || null)
  }

  /** Pažymima iškart, serveris patvirtina fone — parduotuvėje ryšys būna lėtas. */
  function pazymeti(p: Preke, nupirktas: boolean) {
    keisti((d) => ({
      ...d,
      items: d.items.map((x) => (x.id === p.id ? { ...x, checked_at: nupirktas ? new Date().toISOString() : null, checked_by: as } : x)),
    }))
    void siusti({ tipas: 'pazymeti', id: p.id, checked: nupirktas }, () => darbai.keistiPreke(p.id, { checked: nupirktas }, as))
  }

  function istrinti(p: Preke) {
    keisti((d) => ({ ...d, items: d.items.filter((x) => x.id !== p.id) }))
    if (p.id < 0) {
      ismestiLaikina(p.id)
      setLaukia(eile().length)
      return
    }
    void siusti({ tipas: 'istrinti', id: p.id }, () => darbai.istrintiPreke(p.id))
  }

  async function keistiSkyriu(p: Preke, skyrius: string) {
    keisti((d) => ({ ...d, items: d.items.map((x) => (x.id === p.id ? { ...x, section: skyrius } : x)) }))
    if (p.id < 0) return
    try {
      await darbai.keistiPreke(p.id, { section: skyrius }, as)
    } catch (err) {
      setKlaida(rysioKlaida(err) ? 'Be ryšio skyriaus pakeisti nepavyko — pabandyk, kai bus ryšys.' : klaidosTekstas(err))
      void load()
    }
  }

  const kas = (id: number | null) => {
    const narys = nariai.find((n) => n.id === id)
    return narys ? inicialai(narys.name) : null
  }

  const eilute = (p: Preke) => (
    <li key={p.id} className="uzd-eilute pirk-eilute">
      <button className="uzd-zyme" onClick={() => pazymeti(p, true)} aria-label={`Nupirkta: ${p.name}`} disabled={tvarkyti}>
        <span aria-hidden="true" />
      </button>
      <button className="uzd-tekstas" onClick={() => !tvarkyti && pazymeti(p, true)}>
        <span className="uzd-pavadinimas">
          {p.name}
          {p.quantity && <span className="pirk-kiekis-tekstas"> · {p.quantity}</span>}
        </span>
      </button>
      {tvarkyti ? (
        <select className="pirk-skyrius" value={p.section ?? 'Kita'} onChange={(e) => void keistiSkyriu(p, e.target.value)} aria-label={`Skyrius: ${p.name}`}>
          {skyriai.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      ) : (
        kas(p.added_by) && (
          <span className="pirk-kas" title="Kas pridėjo">
            {kas(p.added_by)}
          </span>
        )
      )}
      <button className="ghost small" onClick={() => istrinti(p)} aria-label={`Pašalinti „${p.name}“`}>
        ×
      </button>
    </li>
  )

  return (
    <div className="pirkiniai">
      <div className="perjungiklis" role="group" aria-label="Sąrašas">
        {sarasai.map((s) => (
          <button key={s.id} aria-pressed={s.id === aktyvus} onClick={() => rinktisSarasa(s.id)}>
            {s.name}
            {kiekNepirkta(s.id) > 0 && <span className="pirk-skaicius">{kiekNepirkta(s.id)}</span>}
          </button>
        ))}
      </div>

      {beRysio && (
        <p className="pirk-be-rysio">
          Be ryšio — rodomas telefone išsaugotas sąrašas.
          {laukia > 0 ? ` Pakeitimų laukia išsiuntimo: ${laukia}.` : ''}
        </p>
      )}

      <form
        className="uzd-greitai"
        onSubmit={(e) => {
          e.preventDefault()
          pridetiIsFormos()
        }}
      >
        <input
          value={pavadinimas}
          onChange={(e) => setPavadinimas(e.target.value)}
          placeholder="Ką nupirkti?"
          maxLength={100}
          autoFocus={fokusuoti}
        />
        <input className="pirk-kiekis" value={kiekis} onChange={(e) => setKiekis(e.target.value)} placeholder="kiek" maxLength={30} />
        <button type="submit" disabled={!pavadinimas.trim()}>
          Pridėti
        </button>
      </form>

      {pasiulymai.length > 0 && (
        <div className="pirk-pasiulymai">
          <span className="paaiskinimas">Gal reikia?</span>
          {pasiulymai.map((s) => (
            <button
              key={s.name}
              className="ghost small"
              onClick={() => void prideti(s.name, null)}
              title={`Perkat maždaug kas ${s.every_days} d.`}
            >
              + {s.name}
            </button>
          ))}
        </div>
      )}

      {klaida && <p className="error">{klaida}</p>}
      {!duomenys && !klaida && <p className="paaiskinimas">{beRysio ? 'Be ryšio, o telefone sąrašo dar nėra.' : 'Kraunama…'}</p>}

      {duomenys && (
        <section className="kortele-sarasas">
          {pirkti.length > 0 && (
            <header className="pirk-antraste">
              <span className="paaiskinimas">{tvarkyti ? 'Pasirink kiekvienos prekės skyrių — kitą kartą ji ten ir atsiras.' : ''}</span>
              <button className="ghost small" onClick={() => setTvarkyti(!tvarkyti)} aria-pressed={tvarkyti}>
                {tvarkyti ? 'Baigti' : 'Tvarkyti skyrius'}
              </button>
            </header>
          )}
          {pirkti.length === 0 ? (
            <p className="tuscia">Šiame sąraše nieko nereikia.</p>
          ) : pagalSkyriu.length > 1 ? (
            pagalSkyriu.map((g) => (
              <div key={g.skyrius} className="pirk-skyriaus-grupe">
                <h3 className="pirk-skyriaus-pavadinimas">{g.skyrius}</h3>
                <ul className="uzd-sarasas">{g.prekes.map(eilute)}</ul>
              </div>
            ))
          ) : (
            <ul className="uzd-sarasas">{pirkti.map(eilute)}</ul>
          )}
        </section>
      )}

      {nupirkta.length > 0 && (
        <section className="uzd-atliktos">
          <button className="linkish" onClick={() => setRodytiNupirktas(!rodytiNupirktas)} aria-expanded={rodytiNupirktas}>
            {rodytiNupirktas ? '▾' : '▸'} Nupirkta ({nupirkta.length})
          </button>
          {rodytiNupirktas && (
            <ul className="uzd-sarasas">
              {nupirkta.map((p) => (
                <li key={p.id} className="uzd-eilute atlikta pirk-eilute">
                  <button className="uzd-zyme" onClick={() => pazymeti(p, false)} aria-label={`Vėl reikia: ${p.name}`} title="Vėl reikia">
                    <span aria-hidden="true">✓</span>
                  </button>
                  <span className="uzd-pavadinimas">
                    {p.name}
                    {p.quantity && <span className="pirk-kiekis-tekstas"> · {p.quantity}</span>}
                  </span>
                  {kas(p.checked_by) && <span className="pirk-kas">{kas(p.checked_by)}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}
