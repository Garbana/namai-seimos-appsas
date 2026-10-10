import { useEffect, useState } from 'react'
import { useNariai } from '../darbai/nariai'
import { claude, type Prasymas } from './api'

const klaidosTekstas = (err: unknown) => (err instanceof Error ? err.message : 'Nepavyko.')

/**
 * Claude programa jungiasi prie appso: čia (už Access) žmogus pasirenka, kieno vardu Claude
 * dirbs, ir leidžia arba ne. Tada grąžinam į jungties Worker'į, o tas — į Claude.
 */
export default function ClaudeLeidimas({ state, onUzdaryti }: { state: string; onUzdaryti: () => void }) {
  const { nariai, as } = useNariai()
  const naudoja = nariai.filter((n) => n.uses_app)
  const [prasymas, setPrasymas] = useState<Prasymas | null>(null)
  const [narys, setNarys] = useState<number | null>(as)
  const [klaida, setKlaida] = useState<string | null>(null)
  const [siunciama, setSiunciama] = useState(false)

  useEffect(() => {
    claude
      .prasymas(state)
      .then(setPrasymas)
      .catch((err) => setKlaida(klaidosTekstas(err)))
  }, [state])

  const pasirinktas = narys ?? as

  async function spresti(leisti: boolean) {
    setSiunciama(true)
    setKlaida(null)
    try {
      const { toliau } = await claude.spresti(state, leisti ? pasirinktas : null, leisti)
      window.location.href = toliau
    } catch (err) {
      setKlaida(klaidosTekstas(err))
      setSiunciama(false)
    }
  }

  const uzdaryti = (
    <button className="ghost" onClick={onUzdaryti}>
      Uždaryti
    </button>
  )

  let turinys
  if (!prasymas) {
    turinys = klaida ? (
      <>
        <p className="error">{klaida}</p>
        {uzdaryti}
      </>
    ) : (
      <p className="paaiskinimas">Kraunama…</p>
    )
  } else if (prasymas.busena === 'leista') {
    turinys = (
      <>
        <p>Jau leista — liko grįžti į Claude.</p>
        <button onClick={() => (window.location.href = prasymas.toliau)}>Tęsti</button>
      </>
    )
  } else if (prasymas.busena !== 'laukia' || prasymas.pasibaige) {
    turinys = (
      <>
        <p>
          {prasymas.pasibaige ? 'Prašymas pasibaigė (galioja 10 min.).' : 'Šis prašymas jau išspręstas.'} Jei reikia, junk iš naujo
          Claude programoje.
        </p>
        {uzdaryti}
      </>
    )
  } else {
    turinys = (
      <>
        <p>
          <b>{prasymas.programa}</b> nori prisijungti prie šeimos appso. Prieiga bus perduota į <b>{prasymas.adresas}</b>.
        </p>
        {prasymas.vietine && (
          <p className="claude-ispejimas">
            Prieiga keliaus programai šiame kompiuteryje. Leisk tik jei ką tik pats jungei Claude.
          </p>
        )}
        <ul className="claude-galimybes">
          <li>Matys užduotis, projektus, pirkinius ir finansus.</li>
          <li>Galės kurti ir keisti užduotis, projektus ir pirkinius.</li>
          <li>Finansų keisti negalės.</li>
        </ul>
        <div>
          <p className="paaiskinimas">Kas jungiasi? Claude „aš“ reikš šį žmogų.</p>
          <div className="kas-as-mygtukai">
            {naudoja.map((n) => (
              <button key={n.id} className={n.id === pasirinktas ? undefined : 'ghost'} aria-pressed={n.id === pasirinktas} onClick={() => setNarys(n.id)}>
                <span className="uzd-narys" style={{ background: n.color }} aria-hidden="true">
                  {n.name.slice(0, 2)}
                </span>
                {n.name}
              </button>
            ))}
          </div>
        </div>
        {klaida && <p className="error">{klaida}</p>}
        <div className="claude-mygtukai">
          <button disabled={siunciama || pasirinktas === null} onClick={() => void spresti(true)}>
            Leisti
          </button>
          <button className="ghost" disabled={siunciama} onClick={() => void spresti(false)}>
            Neleisti
          </button>
        </div>
        <p className="paaiskinimas">Atjungti galima bet kada: Daugiau → Claude jungtis.</p>
      </>
    )
  }

  return (
    <div className="modal-fonas" role="presentation">
      <div className="modal claude-leidimas" role="dialog" aria-label="Prijungti Claude?">
        <h3>Prijungti Claude?</h3>
        {turinys}
      </div>
    </div>
  )
}
