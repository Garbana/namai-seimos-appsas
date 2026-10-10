import { useEffect, useState } from 'react'
import { pilnaData } from '../darbai/datos'
import { useNariai } from '../darbai/nariai'
import { googleNuoroda, kalendorius, type Ivykis, type IvykioLaukai } from './api'

type Props = {
  /** null — naujas įvykis. */
  ivykis: Ivykis | null
  /** Naujam — kuri diena (pvz., paspaustoji kalendoriuje). */
  data?: string
  /** Prijungto Google kalendoriaus adresas — nuorodai į įvykį Google'e. */
  googleKalendorius?: string | null
  onUzdaryti: () => void
  onPakeista: (zinute?: { tekstas: string; atsaukti?: () => void }) => void
}

const PAKARTOJIMAI: { reiksme: string; vardas: string }[] = [
  { reiksme: '', vardas: 'Nesikartoja' },
  { reiksme: 'FREQ=WEEKLY', vardas: 'Kas savaitę' },
  { reiksme: 'FREQ=WEEKLY;INTERVAL=2', vardas: 'Kas 2 savaites' },
  { reiksme: 'FREQ=MONTHLY', vardas: 'Kas mėnesį' },
  { reiksme: 'FREQ=YEARLY', vardas: 'Kasmet' },
]

const klaidosTekstas = (err: unknown) => (err instanceof Error ? err.message : 'Nepavyko.')

/**
 * Įvykio langas: pavadinimas, kada (visą dieną ar nuo–iki), kas dalyvauja, vieta, pakartojimas.
 * Pasikartojančio įvykio kartą keičiant ar trinant — „Tik šį kartą“ ar „Visus kartus“.
 */
export default function IvykioDialogas({ ivykis: pradinis, data, googleKalendorius, onUzdaryti, onPakeista }: Props) {
  const { nariai, as } = useNariai()
  // Appse skaičiuojamos serijos (dar ne Google) kartas — redaguojama visa serija nuo jos pradžios.
  const vietineSerija = pradinis !== null && pradinis.series && !pradinis.google
  const [e, setE] = useState<Ivykis | null>(vietineSerija ? null : pradinis)
  const [klaida, setKlaida] = useState<string | null>(null)

  useEffect(() => {
    if (!vietineSerija) return
    kalendorius
      .ivykis(pradinis!.id)
      .then(setE)
      .catch((err) => setKlaida(klaidosTekstas(err)))
  }, [vietineSerija, pradinis])

  if (pradinis && !e) {
    return (
      <div className="modal-fonas" onClick={onUzdaryti} role="presentation">
        <div className="modal" role="dialog">
          {klaida ? <p className="error">{klaida}</p> : <p className="paaiskinimas">Kraunama…</p>}
        </div>
      </div>
    )
  }
  return (
    <Forma
      key={e?.id ?? 'naujas'}
      e={e}
      data={data}
      nariai={nariai}
      as={as}
      googleKalendorius={googleKalendorius ?? null}
      onUzdaryti={onUzdaryti}
      onPakeista={onPakeista}
    />
  )
}

function Forma({
  e,
  data,
  nariai,
  as,
  googleKalendorius,
  onUzdaryti,
  onPakeista,
}: {
  e: Ivykis | null
  data?: string
  googleKalendorius: string | null
  nariai: { id: number; name: string; color: string }[]
  as: number | null
  onUzdaryti: () => void
  onPakeista: Props['onPakeista']
}) {
  const [pavadinimas, setPavadinimas] = useState(e?.title ?? '')
  const [diena, setDiena] = useState(e?.start_date ?? data ?? '')
  const [visaDiena, setVisaDiena] = useState(e ? e.start_time === null : false)
  const [nuo, setNuo] = useState(e?.start_time ?? '')
  const [iki, setIki] = useState(e?.end_time ?? '')
  const [ikiDienos, setIkiDienos] = useState(e && e.end_date !== e.start_date ? e.end_date : '')
  const [dalyviai, setDalyviai] = useState<number[]>(e?.members ?? [])
  const [vieta, setVieta] = useState(e?.location ?? '')
  const [pastabos, setPastabos] = useState(e?.notes ?? '')
  const [pakartojimas, setPakartojimas] = useState(e?.recurrence ?? '')
  const [klaida, setKlaida] = useState<string | null>(null)
  const [saugoma, setSaugoma] = useState(false)
  // Google serijos kartas: kai paspausta „Išsaugoti“ ar „Ištrinti“ — klausiam, ar tik šį.
  const [klausti, setKlausti] = useState<'saugoti' | 'trinti' | null>(null)
  const googleKartas = e !== null && e.series && e.google

  function laukai(): IvykioLaukai {
    const l: IvykioLaukai = {
      title: pavadinimas.trim(),
      startDate: diena,
      startTime: visaDiena ? null : nuo || null,
      endTime: visaDiena ? null : iki || null,
      endDate: visaDiena ? ikiDienos || diena : undefined,
      memberIds: dalyviai,
      location: vieta.trim() || null,
      notes: pastabos.trim() || null,
    }
    if (!googleKartas) l.recurrence = pakartojimas || null
    return l
  }

  async function issaugoti(visiems = false) {
    if (!pavadinimas.trim()) return setKlaida('Įvykiui reikia pavadinimo.')
    if (!diena) return setKlaida('Pasirink dieną.')
    if (!visaDiena && !nuo) return setKlaida('Nurodyk pradžios laiką arba pažymėk „Visą dieną“.')
    if (googleKartas && klausti === null) return setKlausti('saugoti')
    setSaugoma(true)
    setKlaida(null)
    try {
      if (e) await kalendorius.keisti(e.id, visiems ? { ...laukai(), startDate: undefined, endDate: undefined } : laukai(), visiems)
      else await kalendorius.sukurti(laukai(), as)
      onPakeista()
      onUzdaryti()
    } catch (err) {
      setKlaida(klaidosTekstas(err))
      setSaugoma(false)
      setKlausti(null)
    }
  }

  async function istrinti(visiems = false) {
    if (!e) return
    if (googleKartas && klausti === null) return setKlausti('trinti')
    if (!googleKartas && !confirm(`Ištrinti „${e.title}“${e.series ? ' (visus kartus)' : ''}?`)) return
    setSaugoma(true)
    try {
      await kalendorius.istrinti(e.id, visiems)
      onPakeista({ tekstas: `Ištrinta: ${e.title}`, atsaukti: visiems ? undefined : () => void kalendorius.atkurti(e.id).then(() => onPakeista()) })
      onUzdaryti()
    } catch (err) {
      setKlaida(klaidosTekstas(err))
      setSaugoma(false)
      setKlausti(null)
    }
  }

  const perjungtiDalyvi = (id: number) => setDalyviai((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id].sort((a, b) => a - b)))

  return (
    <div className="modal-fonas" onClick={onUzdaryti} role="presentation">
      <div className="modal uzd-dialogas ivykio-dialogas" role="dialog" aria-label={e ? 'Įvykis' : 'Naujas įvykis'} onClick={(ev) => ev.stopPropagation()}>
        <h3>{e ? 'Įvykis' : 'Naujas įvykis'}</h3>

        <label>
          Kas
          <input value={pavadinimas} onChange={(ev) => setPavadinimas(ev.target.value)} placeholder="pvz., Dantistė, Repeticija" autoFocus={!e} maxLength={200} />
        </label>

        <div className="uzd-du-laukai">
          <label>
            Diena
            <input type="date" value={diena} onChange={(ev) => setDiena(ev.target.value)} />
          </label>
          <label className="check ivykio-visa-diena">
            <input type="checkbox" checked={visaDiena} onChange={(ev) => setVisaDiena(ev.target.checked)} />
            Visą dieną
          </label>
        </div>
        {diena && <p className="paaiskinimas">{pilnaData(diena)}</p>}

        {visaDiena ? (
          <label>
            Iki (paskutinė diena, jei kelios)
            <input type="date" value={ikiDienos} min={diena} onChange={(ev) => setIkiDienos(ev.target.value)} />
          </label>
        ) : (
          <div className="uzd-du-laukai">
            <label>
              Nuo
              <input type="time" value={nuo} onChange={(ev) => setNuo(ev.target.value)} />
            </label>
            <label>
              Iki
              <input type="time" value={iki} onChange={(ev) => setIki(ev.target.value)} placeholder="+1 val." />
            </label>
          </div>
        )}

        <div>
          <span className="paaiskinimas">Kas dalyvauja (nepažymėjus — visa šeima)</span>
          <div className="ruosa-nariai">
            {nariai.map((n) => (
              <button key={n.id} type="button" className={dalyviai.includes(n.id) ? undefined : 'ghost'} aria-pressed={dalyviai.includes(n.id)} onClick={() => perjungtiDalyvi(n.id)}>
                <span className="uzd-narys" style={{ background: n.color }} aria-hidden="true">
                  {n.name.slice(0, 2)}
                </span>
                {n.name}
              </button>
            ))}
          </div>
        </div>

        <label>
          Vieta
          <input value={vieta} onChange={(ev) => setVieta(ev.target.value)} maxLength={300} />
        </label>

        {googleKartas ? (
          <p className="paaiskinimas">↻ Pasikartojantis įvykis.</p>
        ) : (
          <label>
            Pasikartoja
            <select value={pakartojimas} onChange={(ev) => setPakartojimas(ev.target.value)}>
              {PAKARTOJIMAI.map((p) => (
                <option key={p.reiksme} value={p.reiksme}>
                  {p.vardas}
                </option>
              ))}
              {pakartojimas && !PAKARTOJIMAI.some((p) => p.reiksme === pakartojimas) && <option value={pakartojimas}>{pakartojimas}</option>}
            </select>
          </label>
        )}

        <label>
          Pastabos
          <textarea value={pastabos} onChange={(ev) => setPastabos(ev.target.value)} rows={2} maxLength={5000} />
        </label>

        {e?.sync_state === 'klaida' && <p className="claude-ispejimas">Google kalendoriuje dar neatnaujinta: {e.sync_error}</p>}
        {e?.google_id && googleKalendorius && (
          <a className="ivykio-google" href={googleNuoroda(e.google_id, googleKalendorius)} target="_blank" rel="noreferrer">
            Atidaryti Google kalendoriuje ↗
          </a>
        )}
        {klaida && <p className="error">{klaida}</p>}

        {klausti ? (
          <div className="ivykio-klausimas">
            <p>{klausti === 'saugoti' ? 'Keisti tik šį kartą ar visus kartus?' : 'Ištrinti tik šį kartą ar visus kartus?'}</p>
            <div className="modal-mygtukai">
              <button className="ghost" onClick={() => setKlausti(null)} disabled={saugoma}>
                Atšaukti
              </button>
              <button className="ghost" onClick={() => void (klausti === 'saugoti' ? issaugoti(true) : istrinti(true))} disabled={saugoma}>
                Visus kartus
              </button>
              <button onClick={() => void (klausti === 'saugoti' ? issaugoti(false) : istrinti(false))} disabled={saugoma}>
                Tik šį kartą
              </button>
            </div>
          </div>
        ) : (
          <div className="modal-mygtukai">
            {e && (
              <button className="ghost uzd-trinti" onClick={() => void istrinti()} disabled={saugoma}>
                Ištrinti
              </button>
            )}
            <button className="ghost" onClick={onUzdaryti}>
              Atšaukti
            </button>
            <button onClick={() => void issaugoti()} disabled={saugoma}>
              {saugoma ? 'Saugoma…' : 'Išsaugoti'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
