import { useCallback, useEffect, useState } from 'react'
import { useNariai } from './darbai/nariai'
import { ijungti, isjungti, palaikoma, pranesimuApi, sioPrenumerata, type PranesimuBusena } from './prenumerata'

const klaidosTekstas = (err: unknown) => (err instanceof Error ? err.message : 'Nepavyko.')

/** „07:30“ → „7:30“. */
const laikas = (hhmm: string) => hhmm.replace(/^0/, '')

const kada = (iso: string) =>
  new Date(iso).toLocaleString('lt-LT', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })

/** Pranešimų nustatymai: šis įrenginys, kas ateina ir visi užsiprenumeravę įrenginiai. */
export default function Pranesimai({ onKeistiAs }: { onKeistiAs: () => void }) {
  const { nariai, as } = useNariai()
  const [busena, setBusena] = useState<PranesimuBusena | null>(null)
  const [endpoint, setEndpoint] = useState<string | null>(null)
  const [leidimas, setLeidimas] = useState<NotificationPermission | null>(palaikoma() ? Notification.permission : null)
  const [klaida, setKlaida] = useState<string | null>(null)
  const [zinia, setZinia] = useState<string | null>(null)
  const [dirbama, setDirbama] = useState(false)

  const load = useCallback(() => {
    Promise.all([pranesimuApi.busena(), sioPrenumerata()])
      .then(([b, sub]) => {
        setBusena(b)
        setEndpoint(sub?.endpoint ?? null)
        if (palaikoma()) setLeidimas(Notification.permission)
      })
      .catch((err) => setKlaida(klaidosTekstas(err)))
  }, [])

  useEffect(() => load(), [load])

  async function veiksmas(darbas: () => Promise<string | null>) {
    setDirbama(true)
    setKlaida(null)
    setZinia(null)
    try {
      setZinia(await darbas())
    } catch (err) {
      setKlaida(klaidosTekstas(err))
    } finally {
      setDirbama(false)
      load()
    }
  }

  const asVardas = nariai.find((n) => n.id === as)?.name
  const vardas = (id: number) => nariai.find((n) => n.id === id)?.name ?? '?'
  const sisIrenginys = busena?.irenginiai.find((i) => i.endpoint === endpoint) ?? null

  let sioBusena
  if (!palaikoma()) {
    sioBusena = (
      <p className="paaiskinimas">
        Ši naršyklė pranešimų nepalaiko. Telefone atsidaryk appsą iš pradžios ekrano ikonos arba per Chrome.
      </p>
    )
  } else if (busena && !busena.raktas) {
    sioBusena = <p className="error">Serveryje nenustatytas pranešimų raktas — pranešimai dar neveikia.</p>
  } else if (as === null) {
    sioBusena = (
      <button onClick={onKeistiAs}>Pirma pasirink, kas naudoja šį įrenginį</button>
    )
  } else if (leidimas === 'denied') {
    sioBusena = (
      <div className="pranesimai-uzblokuota">
        <p className="error">Pranešimai šiam appsui užblokuoti.</p>
        <p className="paaiskinimas">
          Telefone: <b>Nustatymai → Programos → Namai</b> (arba <b>Chrome</b>) <b>→ Pranešimai</b> → leisti. Kompiuteryje:
          spynelė prie adreso → <b>Pranešimai</b> → leisti. Tada grįžk čia ir spausk „Patikrinti dar kartą“.
        </p>
        <button className="ghost" onClick={load}>
          Patikrinti dar kartą
        </button>
      </div>
    )
  } else if (sisIrenginys && leidimas === 'granted') {
    sioBusena = (
      <>
        <p className="pranesimai-ijungta">✓ Pranešimai šiame įrenginyje įjungti</p>
        <div className="pranesimai-mygtukai">
          <button
            disabled={dirbama}
            onClick={() =>
              void veiksmas(async () => {
                const r = await pranesimuApi.bandyti(sisIrenginys.endpoint)
                if (!r.ok) throw new Error(r.klaida ?? 'Nepavyko išsiųsti.')
                return 'Išsiųsta — po kelių sekundžių pranešimas turėtų atsirasti.'
              })
            }
          >
            Išbandyti
          </button>
          <button
            className="ghost"
            disabled={dirbama}
            onClick={() =>
              void veiksmas(async () => {
                await isjungti()
                return 'Pranešimai šiame įrenginyje išjungti.'
              })
            }
          >
            Išjungti
          </button>
        </div>
      </>
    )
  } else {
    sioBusena = (
      <button
        disabled={dirbama || !busena?.raktas}
        onClick={() =>
          void veiksmas(async () => {
            await ijungti(as, busena!.raktas!)
            return 'Įjungta. Spausk „Išbandyti“, kad pamatytum, kaip atrodo.'
          })
        }
      >
        {dirbama ? 'Įjungiama…' : 'Įjungti pranešimus šiame įrenginyje'}
      </button>
    )
  }

  return (
    <div className="pranesimai">
      <section className="kortele-sarasas">
        <header>
          <h2>Šis įrenginys</h2>
        </header>
        <p className="pranesimai-kam">
          Pranešimai ateina tam, kas naudoja šį įrenginį: <b>{asVardas ?? 'nepasirinkta'}</b>{' '}
          <button className="linkish" onClick={onKeistiAs}>
            keisti
          </button>
        </p>
        {sioBusena}
        {zinia && <p className="pranesimai-zinia">{zinia}</p>}
        {klaida && <p className="error">{klaida}</p>}
      </section>

      <section className="kortele-sarasas">
        <header>
          <h2>Kas ateina</h2>
        </header>
        <ul className="pranesimai-tvarka">
          <li>
            <b>{laikas(busena?.tvarka.suvestine ?? '07:30')}</b>
            <span>Rytinė suvestinė — tavo, bendri ir vaikų šiandienos bei vėluojantys darbai.</span>
          </li>
          <li>
            <b>Priminimai</b>
            <span>Tie, kuriuos nustatai užduotyje („Priminti“). Ateina atsakingam; bendri ir vaikų — visiems.</span>
          </li>
          <li>
            <b>Priskyrimas</b>
            <span>Kai kitas tau priskiria darbą.</span>
          </li>
          <li>
            <b>
              {laikas(busena?.tvarka.tylaNuo ?? '22:00')}–{laikas(busena?.tvarka.tylaIki ?? '07:00')}
            </b>
            <span>Tylos valandos — priminimai palaukia ryto.</span>
          </li>
        </ul>
        <p className="paaiskinimas">Pranešime galima iškart spausti „Atlikta“ arba „Atidėti 1 val.“</p>
      </section>

      {busena && busena.irenginiai.length > 0 && (
        <section className="kortele-sarasas">
          <header>
            <h2>Įrenginiai</h2>
          </header>
          <ul className="pranesimai-irenginiai">
            {busena.irenginiai.map((i) => (
              <li key={i.id}>
                <div>
                  <b>
                    {vardas(i.member_id)} · {i.device ?? 'įrenginys'}
                    {i.endpoint === endpoint && <span className="pranesimai-sis"> (šis)</span>}
                  </b>
                  <small>{i.last_success_at ? `Paskutinis pristatytas ${kada(i.last_success_at)}` : 'Dar nieko nepristatyta'}</small>
                  {i.failed_count > 0 && (
                    <small className="pranesimai-klaida">
                      Nepavyko {i.failed_count} k. Paskutinė klaida: {i.last_error}
                    </small>
                  )}
                </div>
                {i.endpoint !== endpoint && (
                  <button
                    className="ghost small"
                    disabled={dirbama}
                    onClick={() =>
                      confirm(`Pašalinti ${vardas(i.member_id)} „${i.device ?? 'įrenginį'}“? Į jį pranešimai nebeateis.`) &&
                      void veiksmas(async () => {
                        await pranesimuApi.pasalinti(i.id)
                        return null
                      })
                    }
                  >
                    Pašalinti
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
