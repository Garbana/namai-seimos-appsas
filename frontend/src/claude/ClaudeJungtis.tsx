import { useCallback, useEffect, useState } from 'react'
import { claude, type Jungtis } from './api'
import { useModulis } from '../nustatymai'

const klaidosTekstas = (err: unknown) => (err instanceof Error ? err.message : 'Nepavyko.')

const kada = (iso: string) => new Date(iso).toLocaleString('lt-LT', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })

/** „Daugiau → Claude jungtis“: adresas Claude programai, kaip prijungti ir kas prijungta. */
export default function ClaudeJungtis() {
  const finansai = useModulis('finansai')
  const [duomenys, setDuomenys] = useState<{ adresas: string; jungtys: Jungtis[] } | null>(null)
  const [klaida, setKlaida] = useState<string | null>(null)
  const [nukopijuota, setNukopijuota] = useState(false)
  const [dirbama, setDirbama] = useState(false)

  const load = useCallback(() => {
    claude
      .jungtys()
      .then(setDuomenys)
      .catch((err) => setKlaida(klaidosTekstas(err)))
  }, [])

  useEffect(() => load(), [load])

  async function kopijuoti(adresas: string) {
    try {
      await navigator.clipboard.writeText(adresas)
      setNukopijuota(true)
      window.setTimeout(() => setNukopijuota(false), 2000)
    } catch {
      setKlaida('Nepavyko nukopijuoti — pažymėk adresą ir nukopijuok ranka.')
    }
  }

  async function atjungti(j: Jungtis) {
    if (!confirm(`Atjungti „${j.programa}“${j.narys ? ` (${j.narys})` : ''}? Claude nebematys appso, kol neprijungsi iš naujo.`)) return
    setDirbama(true)
    setKlaida(null)
    try {
      await claude.atjungti(j.id)
      load()
    } catch (err) {
      setKlaida(klaidosTekstas(err))
    } finally {
      setDirbama(false)
    }
  }

  return (
    <div className="claude-jungtis">
      <section className="kortele-sarasas claude-apie">
        <p>
          Claude programa (claude.ai, telefone ir kompiuteryje) gali matyti appsą ir į jį įrašyti. Pavyzdžiui, pokalbyje su Claude
          suplanavus gimtadienį — paprašyk: <i>„perkelk šį planą į Namų projektus“</i>.
        </p>
        <p className="paaiskinimas">
          {finansai
            ? 'Claude mato užduotis, projektus, pirkinius, kalendorių ir finansus; keisti gali viską, išskyrus finansus.'
            : 'Claude mato užduotis, projektus, pirkinius ir kalendorių ir gali juos keisti.'}
        </p>

        {duomenys && (
          <>
            <span className="paaiskinimas">Adresas jungčiai</span>
            <div className="claude-adresas">
              <code>{duomenys.adresas}</code>
              <button className="small" onClick={() => void kopijuoti(duomenys.adresas)}>
                {nukopijuota ? '✓ Nukopijuota' : 'Kopijuoti'}
              </button>
            </div>
          </>
        )}

        <ol className="claude-zingsniai">
          <li>
            Kompiuteryje atidaryk <b>claude.ai</b> → <b>Customize → Connectors</b> (kartais vadinasi Settings → Connectors).
          </li>
          <li>
            Spausk <b>+ Add → Add custom connector</b>. Pavadinimas — <b>Namai</b>, URL — adresas aukščiau. Spausk <b>Add</b>.
          </li>
          <li>
            Spausk <b>Connect</b>: atsidarys šis appsas — pasirink, kas jungiasi, ir spausk <b>Leisti</b>.
          </li>
          <li>
            Pokalbyje jungtį įjunk per <b>+</b> (apačioje kairėje) → <b>Connectors → Namai</b>. Telefono Claude programoje (ta
            pati paskyra) ji atsiras pati.
          </li>
        </ol>
      </section>

      {klaida && <p className="error">{klaida}</p>}
      {!duomenys && !klaida && <p className="paaiskinimas">Kraunama…</p>}

      {duomenys && (
        <section className="kortele-sarasas">
          <header>
            <h2>Prijungta</h2>
            <span className="paaiskinimas">{duomenys.jungtys.length}</span>
          </header>
          {duomenys.jungtys.length === 0 ? (
            <p className="tuscia">Kol kas niekas neprijungta.</p>
          ) : (
            <ul className="claude-jungtys">
              {duomenys.jungtys.map((j) => (
                <li key={j.id}>
                  <span>
                    <b>{j.programa}</b>
                    {j.narys ? ` · ${j.narys}` : ''}
                    <small className="paaiskinimas">
                      Prijungta {kada(j.prijungta)}
                      {j.naudota ? ` · naudota ${kada(j.naudota)}` : ''}
                    </small>
                  </span>
                  <button className="ghost small" disabled={dirbama} onClick={() => void atjungti(j)}>
                    Atjungti
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}
