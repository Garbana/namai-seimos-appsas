import { useEffect, useMemo, useState } from 'react'
import { api, eur, type BiudzetoEilute, type BiudzetoRibos as Ribos } from './api'

type Props = {
  /** Kurio mėnesio ribos rodomos. */
  menuo: string
  /** Kad pakeitus ribą atsinaujintų ir kiti ekrano skaičiai. */
  onPakeista?: () => void
}

/** Kablelis ar taškas — abu tinka; tuščia reikšmė reiškia „nuimti ribą". */
const centai = (tekstas: string): number | null => {
  const isvalytas = tekstas.trim().replace(/\s/g, '').replace(',', '.')
  if (!isvalytas) return 0
  const skaicius = Number(isvalytas)
  if (!Number.isFinite(skaicius) || skaicius < 0) return null
  return Math.round(skaicius * 100)
}

const eurais = (cents: number) => (cents / 100).toFixed(2).replace('.', ',')

export default function BiudzetoRibos({ menuo, onPakeista }: Props) {
  const [ribos, setRibos] = useState<Ribos | null>(null)
  const [klaida, setKlaida] = useState<string | null>(null)
  const [taisoma, setTaisoma] = useState<number | null>(null)
  const [reiksme, setReiksme] = useState('')
  const [tikSiMenesi, setTikSiMenesi] = useState(false)
  const [saugoma, setSaugoma] = useState(false)
  const [pridedama, setPridedama] = useState(false)

  useEffect(() => {
    let gyvas = true
    api
      .budgets(menuo)
      .then((d) => {
        if (gyvas) setRibos(d)
      })
      .catch((e) => {
        if (gyvas) setKlaida(e instanceof Error ? e.message : 'Nepavyko užkrauti ribų.')
      })
    return () => {
      gyvas = false
    }
  }, [menuo])

  // Grupės, kurios šį mėnesį nefigūruoja sąraše — joms ribą dar galima pridėti.
  const beRibos = useMemo(() => {
    if (!ribos) return []
    const matomos = new Set(ribos.eilutes.map((e) => e.categoryId))
    return ribos.grupes.filter((g) => !matomos.has(g.id))
  }, [ribos])

  const perkrauti = async () => {
    setRibos(await api.budgets(menuo))
    onPakeista?.()
  }

  const pradetiTaisyti = (e: BiudzetoEilute) => {
    setTaisoma(e.categoryId)
    setReiksme(e.plannedCents === null ? '' : eurais(e.plannedCents))
    setTikSiMenesi(e.periodas !== null && e.periodas !== 'numatyta')
    setKlaida(null)
  }

  const issaugoti = async (categoryId: number) => {
    const suma = centai(reiksme)
    if (suma === null) {
      setKlaida('Riba turi būti teigiamas skaičius arba tuščia.')
      return
    }
    setSaugoma(true)
    try {
      await api.saveBudget({
        categoryId,
        period: tikSiMenesi ? menuo : undefined,
        plannedCents: suma,
      })
      setTaisoma(null)
      setPridedama(false)
      setKlaida(null)
      await perkrauti()
    } catch (e) {
      setKlaida(e instanceof Error ? e.message : 'Nepavyko išsaugoti ribos.')
    } finally {
      setSaugoma(false)
    }
  }

  const nuimti = async (categoryId: number, periodas: string | null) => {
    setSaugoma(true)
    try {
      // Nuimama būtent ta riba, kuri galioja: mėnesio išimtis arba numatytoji.
      await api.saveBudget({
        categoryId,
        period: periodas && periodas !== 'numatyta' ? periodas : undefined,
        plannedCents: 0,
      })
      setTaisoma(null)
      setKlaida(null)
      await perkrauti()
    } catch (e) {
      setKlaida(e instanceof Error ? e.message : 'Nepavyko nuimti ribos.')
    } finally {
      setSaugoma(false)
    }
  }

  if (klaida && !ribos) return <p className="error">{klaida}</p>
  if (!ribos) return null

  const { dienos, totals } = ribos
  const likoDienu = dienos.viso - dienos.praejo
  const bendraDalis = totals.plannedCents > 0 ? totals.spentWithLimitCents / totals.plannedCents : 0
  const bendraBusena =
    totals.plannedCents === 0
      ? 'neribota'
      : bendraDalis > 1
        ? 'virsyta'
        : bendraDalis > 0.85
          ? 'baigiasi'
          : 'gerai'

  const taisymas = (e: BiudzetoEilute) => (
    <div className="ribos-taisymas">
      <label>
        Riba
        <input
          type="text"
          inputMode="decimal"
          value={reiksme}
          autoFocus
          placeholder="pvz. 250"
          onChange={(ev) => setReiksme(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter') issaugoti(e.categoryId)
            if (ev.key === 'Escape') setTaisoma(null)
          }}
        />
        <span className="silpnas">€</span>
      </label>
      <label className="ribos-menesiui">
        <input
          type="checkbox"
          checked={tikSiMenesi}
          onChange={(ev) => setTikSiMenesi(ev.target.checked)}
        />
        tik šį mėnesį
      </label>
      <div className="ribos-mygtukai">
        <button type="button" disabled={saugoma} onClick={() => issaugoti(e.categoryId)}>
          Išsaugoti
        </button>
        {e.plannedCents !== null && (
          <button
            type="button"
            className="ghost"
            disabled={saugoma}
            onClick={() => nuimti(e.categoryId, e.periodas)}
          >
            Nuimti ribą
          </button>
        )}
        <button type="button" className="ghost" disabled={saugoma} onClick={() => setTaisoma(null)}>
          Atsisakyti
        </button>
      </div>
    </div>
  )

  return (
    <section className="menesio-kortele ribu-kortele">
      <header>
        <h2>Biudžeto ribos</h2>
        <span className="silpnas">{likoDienu > 0 ? `liko ${likoDienu} d.` : 'mėnuo baigėsi'}</span>
      </header>

      {klaida && <p className="error">{klaida}</p>}

      {totals.plannedCents > 0 ? (
        <div className="ribu-suvestine">
          <div className="ribu-suma">
            <b className="num">{eur(totals.spentWithLimitCents)}</b>
            <span className="silpnas">iš {eur(totals.plannedCents)}</span>
          </div>
          <div className={`ribos-juosta ${bendraBusena}`}>
            <i style={{ width: `${Math.min(100, bendraDalis * 100)}%` }} />
            {dienos.dalis < 1 && <u style={{ left: `${dienos.dalis * 100}%` }} />}
          </div>
          <p className="silpnas">
            Pagal dienas turėtum būti ties {eur(totals.tempasCents)}
            {totals.virsytos > 0 && ` · viršytos grupės: ${totals.virsytos}`}
            {' · '}
            <span className="uzuomina">paspausk grupę, kad pakeistum ribą</span>
          </p>
        </div>
      ) : (
        <p className="silpnas">Ribų dar nenustatyta — įrašyk jas prie grupių žemiau.</p>
      )}

      <ul className="ribu-sarasas">
        {ribos.eilutes.map((e) => (
          <li key={e.categoryId}>
            {/* Visa antraštė — mygtukas, kad ribos taisymui nereiktų atskiros
                eilutės; kitaip kortelė su 9 grupėmis tampa per ilga. */}
            <button
              type="button"
              className="ribos-antraste"
              aria-expanded={taisoma === e.categoryId}
              onClick={() => (taisoma === e.categoryId ? setTaisoma(null) : pradetiTaisyti(e))}
            >
              <span>{e.name}</span>
              <span className="num">
                {e.plannedCents === null ? (
                  <span className="silpnas">nustatyti ribą</span>
                ) : (
                  <>
                    {eur(e.spentCents)}
                    <span className="silpnas"> / {eur(e.plannedCents)}</span>
                  </>
                )}
              </span>
            </button>

            {e.plannedCents !== null ? (
              <>
                <div className={`ribos-juosta ${e.busena}`}>
                  <i style={{ width: `${Math.min(100, (e.pct ?? 0) * 100)}%` }} />
                  {dienos.dalis < 1 && <u style={{ left: `${dienos.dalis * 100}%` }} />}
                </div>
                <div className="ribos-apacia">
                  <span className="silpnas">
                    {Math.round((e.pct ?? 0) * 100)} %
                    {e.periodas && e.periodas !== 'numatyta' && ' · tik šį mėnesį'}
                  </span>
                  <span className={e.busena === 'virsyta' ? 'perzengta' : 'silpnas'}>
                    {e.busena === 'virsyta'
                      ? `viršyta ${eur(-(e.leftCents ?? 0))}`
                      : `liko ${eur(e.leftCents ?? 0)}`}
                    {dienos.dalis < 1 && ` · tokiu tempu ${eur(e.prognozeCents)}`}
                  </span>
                </div>
              </>
            ) : (
              <p className="silpnas">Išleista {eur(e.spentCents)}, riba nenustatyta.</p>
            )}

            {taisoma === e.categoryId && taisymas(e)}
          </li>
        ))}
      </ul>

      {beRibos.length > 0 && (
        <div className="ribu-pridejimas">
          {pridedama ? (
            <label>
              Grupė
              <select
                value={taisoma && beRibos.some((g) => g.id === taisoma) ? String(taisoma) : ''}
                onChange={(ev) => {
                  const id = Number(ev.target.value)
                  setTaisoma(id || null)
                  setReiksme('')
                  setTikSiMenesi(false)
                }}
              >
                <option value="">— pasirink —</option>
                {beRibos.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <button type="button" className="ghost" onClick={() => setPridedama(true)}>
              + Riba kitai grupei
            </button>
          )}

          {pridedama &&
            taisoma !== null &&
            beRibos.some((g) => g.id === taisoma) &&
            taisymas({
              categoryId: taisoma,
              name: beRibos.find((g) => g.id === taisoma)?.name ?? '',
              plannedCents: null,
              periodas: null,
              spentCents: 0,
              pct: null,
              leftCents: null,
              tempasCents: null,
              prognozeCents: 0,
              busena: 'neribota',
            })}
        </div>
      )}

      <div className="paskirstymas">
        <h3>50 / 30 / 20</h3>
        {totals.spentCents > 0 ? (
          ribos.paskirstymas.map((p) => (
            <div key={p.necessity} className="paskirstymo-eilute">
              <span>{p.name}</span>
              <div className="ribos-juosta gerai">
                <i style={{ width: `${Math.min(100, p.dalis * 100)}%` }} />
                <u style={{ left: `${p.tikslas * 100}%` }} />
              </div>
              <span className="num">{Math.round(p.dalis * 100)} %</span>
              <span className="silpnas">tikslas {Math.round(p.tikslas * 100)} %</span>
            </div>
          ))
        ) : (
          <p className="silpnas">Šį mėnesį išlaidų dar nėra.</p>
        )}
      </div>
    </section>
  )
}
