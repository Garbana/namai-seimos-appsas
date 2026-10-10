import { useCallback, useEffect, useState } from 'react'
import { darbai, type Sritis } from '../darbai/api'
import { useNariai } from '../darbai/nariai'
import { asistentas, type Irasas, type Istorija as IstorijosDuomenys } from './api'
import VeiksmoKortele from './VeiksmoKortele'

const klaidosTekstas = (err: unknown) => (err instanceof Error ? err.message : 'Nepavyko.')

const kada = (iso: string) =>
  new Date(iso).toLocaleString('lt-LT', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })

/** Ką padarė asistentas: paskutinės žinutės su veiksmais (galima atšaukti) ir išlaidos. */
export default function AsistentoIstorija({ onAtidaryti }: { onAtidaryti: () => void }) {
  const { nariai, as } = useNariai()
  const [duomenys, setDuomenys] = useState<IstorijosDuomenys | null>(null)
  const [sritys, setSritys] = useState<Sritis[]>([])
  const [klaida, setKlaida] = useState<string | null>(null)
  const [dirbama, setDirbama] = useState(false)

  const load = useCallback(() => {
    Promise.all([asistentas.istorija(), darbai.sritys()])
      .then(([d, s]) => {
        setDuomenys(d)
        setSritys(s)
      })
      .catch((err) => setKlaida(klaidosTekstas(err)))
  }, [])

  useEffect(() => load(), [load])

  async function veiksmas(darbas: () => Promise<Irasas>) {
    setDirbama(true)
    setKlaida(null)
    try {
      const r = await darbas()
      setDuomenys((d) => d && { ...d, irasai: d.irasai.map((i) => (i.id === r.id ? r : i)) })
    } catch (err) {
      setKlaida(klaidosTekstas(err))
    } finally {
      setDirbama(false)
    }
  }

  const vardas = (id: number | null) => nariai.find((n) => n.id === id)?.name ?? '—'
  const islaidos = duomenys?.islaidos

  return (
    <div className="asistento-istorija">
      <section className="kortele-sarasas">
        {duomenys && !duomenys.ijungtas && <p className="error">Asistentas neįjungtas: serveryje nėra Anthropic rakto.</p>}
        {islaidos && (
          <p className="asistento-islaidos">
            Šį mėnesį: <b>{islaidos.menuoUzklausu}</b> žinučių už <b>{islaidos.menuoKainaUsd.toFixed(2).replace('.', ',')} $</b>.
            Šiandien — {islaidos.siandienUzklausu} iš {islaidos.dienosRiba} leidžiamų.
          </p>
        )}
        <button className="small" onClick={onAtidaryti}>
          Atidaryti asistentą
        </button>
      </section>

      {klaida && <p className="error">{klaida}</p>}
      {!duomenys && !klaida && <p className="paaiskinimas">Kraunama…</p>}
      {duomenys && duomenys.irasai.length === 0 && <p className="tuscia">Asistentui dar niekas nerašė.</p>}

      {duomenys?.irasai.map((irasas) => (
        <section key={irasas.id} className="kortele-sarasas asistento-irasas">
          <span className="paaiskinimas">
            {kada(irasas.createdAt)} · {vardas(irasas.memberId)}
          </span>
          <p className="burbulas zmogaus">{irasas.tekstas}</p>
          {irasas.atsakymas && <p className="burbulas asistento">{irasas.atsakymas}</p>}
          {irasas.klaida && <p className="burbulas klaidos">{irasas.klaida}</p>}
          {irasas.veiksmai.map((v) => (
            <VeiksmoKortele
              key={v.id}
              v={v}
              sritys={sritys}
              dirbama={dirbama}
              onPatvirtinti={() => void veiksmas(() => asistentas.patvirtinti(irasas.id, as, [v.id]))}
              onAtmesti={() => void veiksmas(() => asistentas.atmesti(irasas.id, v.id))}
              onAtsaukti={() => void veiksmas(() => asistentas.atsaukti(irasas.id, v.id, as))}
            />
          ))}
        </section>
      ))}
    </div>
  )
}
