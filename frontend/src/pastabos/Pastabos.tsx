import { useCallback, useEffect, useState } from 'react'
import { useBalsas } from '../asistentas/balsas'
import { useNariai } from '../darbai/nariai'
import { pastabos, RUSYS, type Pastaba, type Rusis } from './api'

const klaidosTekstas = (err: unknown) => (err instanceof Error ? err.message : 'Nepavyko.')

const kada = (iso: string) => new Date(iso).toLocaleString('lt-LT', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })

/**
 * Pastabos apie appsą: klaidos, nepatogumai, idėjos, netikę asistento atsakymai. Įrašomos čia,
 * per katinuką („užfiksuok klaidą…“) ar 👎 prie jo atsakymo; Claude jas peržiūri ir tvarko.
 */
export default function Pastabos() {
  const { nariai, as } = useNariai()
  const [sarasas, setSarasas] = useState<Pastaba[] | null>(null)
  const [rusis, setRusis] = useState<Rusis>('klaida')
  const [tekstas, setTekstas] = useState('')
  const [klaida, setKlaida] = useState<string | null>(null)
  const [dirbama, setDirbama] = useState(false)
  const [rodytiSutvarkytas, setRodytiSutvarkytas] = useState(false)
  const balsas = useBalsas((t) => setTekstas((prev) => (prev ? `${prev} ${t}` : t)))

  const load = useCallback(() => {
    pastabos
      .sarasas()
      .then(setSarasas)
      .catch((err) => setKlaida(klaidosTekstas(err)))
  }, [])

  useEffect(() => load(), [load])

  async function veiksmas(darbas: () => Promise<unknown>) {
    setDirbama(true)
    setKlaida(null)
    try {
      await darbas()
      load()
    } catch (err) {
      setKlaida(klaidosTekstas(err))
    } finally {
      setDirbama(false)
    }
  }

  const vardas = (id: number | null) => nariai.find((n) => n.id === id)?.name
  const rusiesVardas = (r: Rusis) => RUSYS.find((x) => x.reiksme === r)?.vardas ?? r
  const naujos = (sarasas ?? []).filter((p) => p.status === 'nauja')
  const sutvarkytos = (sarasas ?? []).filter((p) => p.status !== 'nauja')

  const kortele = (p: Pastaba) => (
    <li key={p.id} className={`pastaba pastaba-${p.status}`}>
      <div className="pastaba-virsus">
        <span className="pastaba-rusis">{rusiesVardas(p.kind)}</span>
        <span className="paaiskinimas">
          {kada(p.created_at)}
          {vardas(p.member_id) ? ` · ${vardas(p.member_id)}` : ''}
          {p.screen ? ` · ${p.screen}` : ''}
        </span>
      </div>
      {p.text && <p className="pastaba-tekstas">{p.text}</p>}
      {p.details && (
        <details className="pastaba-detales">
          <summary>Pokalbis su asistentu</summary>
          <pre>{p.details}</pre>
        </details>
      )}
      {p.resolution && <p className="pastaba-sprendimas">✓ {p.resolution}</p>}
      <div className="pastaba-mygtukai">
        {p.status === 'nauja' ? (
          <button className="small" disabled={dirbama} onClick={() => void veiksmas(() => pastabos.keisti(p.id, { status: 'sutvarkyta' }))}>
            ✓ Sutvarkyta
          </button>
        ) : (
          <button className="ghost small" disabled={dirbama} onClick={() => void veiksmas(() => pastabos.keisti(p.id, { status: 'nauja' }))}>
            Grąžinti į naujas
          </button>
        )}
        <button
          className="ghost small"
          disabled={dirbama}
          onClick={() => confirm('Ištrinti šią pastabą?') && void veiksmas(() => pastabos.istrinti(p.id))}
        >
          Ištrinti
        </button>
      </div>
    </li>
  )

  return (
    <div className="pastabos">
      <section className="kortele-sarasas pastabos-nauja">
        <p className="paaiskinimas">
          Kas neveikia, nepatogu ar ką norėtumėt — užrašykite čia arba pasakykite katinukui („užfiksuok klaidą…“). Claude
          peržiūrės ir pataisys, o sutvarkytas pažymės.
        </p>
        <div className="perjungiklis" role="group" aria-label="Rūšis">
          {RUSYS.filter((r) => r.reiksme !== 'asistentas').map((r) => (
            <button key={r.reiksme} aria-pressed={rusis === r.reiksme} onClick={() => setRusis(r.reiksme)}>
              {r.vardas}
            </button>
          ))}
        </div>
        <div className="pastabos-ivestis">
          <textarea
            value={tekstas}
            onChange={(e) => setTekstas(e.target.value)}
            placeholder={balsas.klauso ? balsas.girdima || 'Klausausi…' : 'Kas negerai ar ką norėtumėt?'}
            rows={3}
            maxLength={4000}
          />
          {balsas.palaikomas && (
            <button
              type="button"
              className={`asistento-mikrofonas${balsas.klauso ? ' klauso' : ''}`}
              onClick={() => (balsas.klauso ? balsas.baigti() : balsas.pradeti(false))}
              aria-label={balsas.klauso ? 'Baigti klausytis' : 'Pasakyti balsu'}
              aria-pressed={balsas.klauso}
            >
              {balsas.klauso ? '■' : '🎤'}
            </button>
          )}
        </div>
        {balsas.klaida && <p className="error">{balsas.klaida}</p>}
        <button
          disabled={dirbama || !tekstas.trim()}
          onClick={() =>
            void veiksmas(async () => {
              await pastabos.sukurti({ kind: rusis, text: tekstas, screen: 'Pastabos' }, as)
              setTekstas('')
            })
          }
        >
          Įrašyti
        </button>
      </section>

      {klaida && <p className="error">{klaida}</p>}
      {!sarasas && !klaida && <p className="paaiskinimas">Kraunama…</p>}

      {sarasas && (
        <section className="kortele-sarasas">
          <header>
            <h2>Naujos</h2>
            <span className="paaiskinimas">{naujos.length}</span>
          </header>
          {naujos.length === 0 ? <p className="tuscia">Naujų pastabų nėra ✓</p> : <ul className="pastabu-sarasas">{naujos.map(kortele)}</ul>}
        </section>
      )}

      {sutvarkytos.length > 0 && (
        <section className="uzd-atliktos">
          <button className="linkish" onClick={() => setRodytiSutvarkytas(!rodytiSutvarkytas)} aria-expanded={rodytiSutvarkytas}>
            {rodytiSutvarkytas ? '▾' : '▸'} Sutvarkytos ({sutvarkytos.length})
          </button>
          {rodytiSutvarkytas && <ul className="pastabu-sarasas">{sutvarkytos.map(kortele)}</ul>}
        </section>
      )}
    </div>
  )
}
