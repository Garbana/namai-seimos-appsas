import { useCallback, useEffect, useState } from 'react'
import { api, type AtsargineKopija } from './api'
import { dienosNuo, kopijuProblema, PARSISIUNTIMO_DIENOS, type KopijuDuomenys } from './kopijos'

const laikas = new Intl.DateTimeFormat('lt-LT', {
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Vilnius',
})
const santykinis = new Intl.RelativeTimeFormat('lt', { numeric: 'auto' })
const skaicius = new Intl.NumberFormat('lt-LT')
const megabaitai = new Intl.NumberFormat('lt-LT', { maximumFractionDigits: 1 })

const kada = (iso: string) => `${laikas.format(new Date(iso))} (${santykinis.format(-dienosNuo(iso), 'day')})`

/**
 * Atsarginės kopijos: parsisiuntimas į kompiuterį ir automatinių kopijų sąrašas.
 * Pačios kopijos daromos serveryje (backups.ts), čia tik rodoma ir parsisiunčiama.
 */
export default function AtsarginesKopijos() {
  const [duomenys, setDuomenys] = useState<KopijuDuomenys | null>(null)
  const [klaida, setKlaida] = useState<string | null>(null)
  const [vyksta, setVyksta] = useState<string | null>(null)

  /**
   * KV sąrašas naujausią įrašą gali parodyti tik po kelių sekundžių, todėl ką tik
   * padaryta kopija pridedama ir rankomis — kitaip ji akimirkai „dingtų“.
   */
  const load = useCallback((nauja?: AtsargineKopija) => {
    api
      .backups()
      .then((d) => {
        const items = nauja && !d.items.some((k) => k.key === nauja.key) ? [nauja, ...d.items] : d.items
        setDuomenys({ ...d, items })
      })
      .catch((err) => setKlaida(err instanceof Error ? err.message : 'Nepavyko užkrauti kopijų.'))
  }, [])

  useEffect(() => load(), [load])

  async function vykdyti<T>(kas: string, darbas: () => Promise<T>, poto: (rezultatas: T) => void) {
    setVyksta(kas)
    setKlaida(null)
    try {
      poto(await darbas())
    } catch (err) {
      setKlaida(err instanceof Error ? err.message : 'Nepavyko.')
    } finally {
      setVyksta(null)
    }
  }

  const items = duomenys?.items ?? []
  const parsisiusta = duomenys?.state.lastDownloadAt ?? null
  const laikasParsisiusti = !parsisiusta || dienosNuo(parsisiusta) > PARSISIUNTIMO_DIENOS
  const problema = duomenys ? kopijuProblema(duomenys) : null

  return (
    <div className="kopijos">
      {klaida && <p className="error">{klaida}</p>}

      <section className="kortele-sarasas">
        <header>
          <h2>Kopija kompiuteryje</h2>
        </header>
        <p className="paaiskinimas">
          Parsisiųsta kopija apsaugo net tada, jei Cloudflare paskyra dingtų. Verta tai daryti kartą per
          mėnesį ir failą laikyti kitur, pavyzdžiui, Google Drive.
        </p>
        {duomenys && (
          <p className="kopijos-busena">
            {parsisiusta ? `Paskutinį kartą parsisiųsta ${kada(parsisiusta)}.` : 'Dar nė karto neparsisiųsta.'}
            {laikasParsisiusti && <span className="tag none">laikas parsisiųsti</span>}
          </p>
        )}
        <button
          disabled={vyksta !== null}
          onClick={() => vykdyti('dabartine', () => api.downloadBackup(), () => load())}
        >
          {vyksta === 'dabartine' ? 'Ruošiama…' : 'Parsisiųsti dabartinę kopiją'}
        </button>
      </section>

      <section className="kortele-sarasas">
        <header>
          <h2>Automatinės kopijos</h2>
          <button
            className="ghost small"
            disabled={vyksta !== null}
            onClick={() => vykdyti('nauja', () => api.createBackup(), (nauja) => load(nauja))}
          >
            {vyksta === 'nauja' ? 'Daroma…' : 'Daryti kopiją dabar'}
          </button>
        </header>
        <p className="paaiskinimas">
          Kas sekmadienį 4–5 val. ryto visa duomenų bazė išsaugoma Cloudflare saugykloje. Laikomos 12
          naujausių automatinių ir 5 rankinės kopijos.
        </p>
        {problema && <p className="error">{problema}</p>}

        {!duomenys && !klaida && <p className="paaiskinimas">Kraunama…</p>}
        {duomenys && items.length === 0 && (
          <p className="paaiskinimas">
            Kopijų dar nėra. Pirmoji bus padaryta sekmadienį arba paspaudus „Daryti kopiją dabar“.
          </p>
        )}

        {items.length > 0 && (
          <ul>
            {items.map((k) => (
              <li key={k.key} className="sarasas-eilute nespaudziama">
                <span>
                  {laikas.format(new Date(k.createdAt))}
                  <small className="po-tekstu">
                    {k.kind === 'auto' ? 'automatinė' : 'rankinė'} · {skaicius.format(k.rows)} eil. ·{' '}
                    {megabaitai.format(k.bytes / 1024 / 1024)} MB
                  </small>
                </span>
                <button
                  className="ghost small"
                  disabled={vyksta !== null}
                  onClick={() => vykdyti(k.key, () => api.downloadBackup(k.key), () => load())}
                >
                  {vyksta === k.key ? 'Ruošiama…' : 'parsisiųsti'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="kortele-sarasas">
        <header>
          <h2>Atkūrimas</h2>
        </header>
        <p className="paaiskinimas">
          Be šių kopijų Cloudflare pati saugo 7 dienų istoriją ir leidžia atsukti duomenų bazę į bet kurią tų
          dienų minutę. Atkūrimas — techninis darbas, aprašytas PROJEKTAS.md skyriuje „Atsarginės kopijos“.
        </p>
      </section>
    </div>
  )
}
