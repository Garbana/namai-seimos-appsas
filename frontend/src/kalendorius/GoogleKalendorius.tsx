import { useCallback, useEffect, useState } from 'react'
import { kalendorius, type GoogleBusena } from './api'

const klaidosTekstas = (err: unknown) => (err instanceof Error ? err.message : 'Nepavyko.')

const kada = (iso: string) => new Date(iso).toLocaleString('lt-LT', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })

/**
 * „Daugiau → Google kalendorius“: prijungti šeimos Google kalendorių (abipusis sinchronizavimas),
 * matyti būseną, sinchronizuoti dabar, atjungti.
 */
export default function GoogleKalendorius() {
  const [b, setB] = useState<GoogleBusena | null>(null)
  const [adresas, setAdresas] = useState('')
  const [klaida, setKlaida] = useState<string | null>(null)
  const [zinia, setZinia] = useState<string | null>(null)
  const [dirbama, setDirbama] = useState(false)
  const [nukopijuota, setNukopijuota] = useState(false)

  const load = useCallback(() => {
    kalendorius
      .google()
      .then(setB)
      .catch((err) => setKlaida(klaidosTekstas(err)))
  }, [])

  useEffect(() => load(), [load])

  async function veiksmas(darbas: () => Promise<{ klaida?: string | null }>, sekme: string) {
    setDirbama(true)
    setKlaida(null)
    setZinia(null)
    try {
      const r = await darbas()
      if (r.klaida) setKlaida(r.klaida)
      else setZinia(sekme)
      load()
    } catch (err) {
      setKlaida(klaidosTekstas(err))
    } finally {
      setDirbama(false)
    }
  }

  async function kopijuoti(tekstas: string) {
    try {
      await navigator.clipboard.writeText(tekstas)
      setNukopijuota(true)
      window.setTimeout(() => setNukopijuota(false), 2000)
    } catch {
      setKlaida('Nepavyko nukopijuoti — pažymėk adresą ir nukopijuok ranka.')
    }
  }

  if (!b) return klaida ? <p className="error">{klaida}</p> : <p className="paaiskinimas">Kraunama…</p>

  return (
    <div className="claude-jungtis">
      <section className="kortele-sarasas claude-apie">
        <p>
          Appso kalendorius ir šeimos Google kalendorius sinchronizuojasi abiem kryptimis: kas sukurta appse — atsiranda Google (ir
          jūsų telefonų kalendoriuose), kas sukurta ar pakeista Google — per kelias minutes atsiranda appse.
        </p>
        <p className="paaiskinimas">Kas dalyvauja, Google'e matysis įvykio spalva — artimiausia nario spalvai appse.</p>

        {!b.paskyra ? (
          <p className="claude-ispejimas">Google prieigos raktas dar neįkeltas į serverį — tai daroma vieną kartą diegiant (docs/DIEGIMAS.md, „Google kalendorius“).</p>
        ) : !b.kalendorius ? (
          <>
            <span className="paaiskinimas">1. Šį adresą pridėk prie šeimos Google kalendoriaus</span>
            <div className="claude-adresas">
              <code>{b.paskyra}</code>
              <button className="small" onClick={() => void kopijuoti(b.paskyra!)}>
                {nukopijuota ? '✓ Nukopijuota' : 'Kopijuoti'}
              </button>
            </div>
            <ol className="claude-zingsniai">
              <li>
                Kompiuteryje atidaryk <b>calendar.google.com</b> šeimos paskyra.
              </li>
              <li>
                Kairėje prie kalendoriaus (jūsų vardas) — <b>⋮ → Nustatymai ir bendrinimas</b>.
              </li>
              <li>
                <b>Bendrinti su konkrečiais žmonėmis → Pridėti žmonių</b>, įklijuok adresą aukščiau, leidimas —{' '}
                <b>Atlikti įvykių pakeitimus</b>, <b>Siųsti</b>.
              </li>
            </ol>
            <label className="google-adresas">
              <span className="paaiskinimas">2. Šeimos Google paskyros el. paštas (kalendoriaus adresas)</span>
              <input type="email" value={adresas} onChange={(e) => setAdresas(e.target.value)} placeholder="seima@gmail.com" />
            </label>
            <button disabled={dirbama || !adresas.trim()} onClick={() => void veiksmas(() => kalendorius.prijungtiGoogle(adresas.trim()), 'Prijungta ✓ Įvykiai importuojami.')}>
              {dirbama ? 'Jungiama…' : 'Prijungti'}
            </button>
          </>
        ) : (
          <>
            <p>
              Prijungta: <b>{b.kalendorius}</b>
            </p>
            <p className="paaiskinimas">
              {b.paskutinis ? `Paskutinį kartą sinchronizuota ${kada(b.paskutinis)}.` : 'Dar nesinchronizuota.'}
              {b.importuojama ? ' Importuojami įvykiai iš Google…' : ''}
              {b.laukia > 0 ? ` Laukia išsiuntimo: ${b.laukia}.` : ''}
              {b.klaidos > 0 ? ` Nepavyko išsiųsti: ${b.klaidos}.` : ''}
            </p>
            {b.klaida && <p className="claude-ispejimas">{b.klaida}</p>}
            <div className="claude-mygtukai">
              <button disabled={dirbama} onClick={() => void veiksmas(() => kalendorius.sinchronizuoti(), 'Sinchronizuota ✓')}>
                {dirbama ? 'Sinchronizuojama…' : 'Sinchronizuoti dabar'}
              </button>
              <button
                className="ghost"
                disabled={dirbama}
                onClick={() =>
                  confirm('Atjungti Google kalendorių? Įvykiai appse liks, bet nebesisinchronizuos.') &&
                  void veiksmas(async () => ({ ...(await kalendorius.atjungtiGoogle()), klaida: null }), 'Atjungta.')
                }
              >
                Atjungti
              </button>
            </div>
          </>
        )}
        {zinia && <p className="pranesimai-zinia">{zinia}</p>}
        {klaida && <p className="error">{klaida}</p>}
      </section>
    </div>
  )
}
