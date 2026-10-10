import { useEffect, useMemo, useState } from 'react'
import {
  api,
  eur,
  menuoVardas,
  type Priminimai as PriminimuDuomenys,
  type Taupymas as TaupymoDuomenys,
  type TaupymoKandidatas,
  type TaupymoTikslas,
} from './api'
import { useNariai } from './darbai/nariai'
import LinijuGrafikas, { type LinijuSerija } from './LinijuGrafikas'
import Priminimai from './Priminimai'

/** Fiksuota spalvų eilė — spalva lieka prie to paties katiliuko. */
const SPALVOS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4']

const PERIODAI: [string, number | null][] = [
  ['3 mėn.', 3],
  ['6 mėn.', 6],
  ['12 mėn.', 12],
  ['Viskas', null],
]

/** Data prieš N mėnesių nuo „šiandien". */
function priesMenesius(siandien: string, menesiai: number) {
  const d = new Date(`${siandien}T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() - menesiai)
  return d.toISOString().slice(0, 10)
}

/**
 * Portfelio vertės linijos: po vieną kiekvienam katiliukui su fondais ir stora
 * „Iš viso" linija. Reikšmės nešamos pirmyn — jei tą dieną kainos nebuvo, imama
 * paskutinė žinoma.
 */
function portfelioSerijos(goals: TaupymoTikslas[], nuo: string) {
  const suFondais = goals.filter((g) => g.chart.length > 0)
  if (suFondais.length === 0) return null

  const datos = [...new Set(suFondais.flatMap((g) => g.chart.map((p) => p.date)))]
    .filter((d) => d >= nuo)
    .sort()
  if (datos.length < 2) return null

  const serijos: LinijuSerija[] = suFondais.map((g, i) => {
    const pagalData = new Map(g.chart.map((p) => [p.date, p.valueCents]))
    const pirma = g.chart[0].date
    let paskutine: number | null = null
    // Prieš pirmą pirkimą — tuščia, vėliau nešame paskutinę žinomą vertę.
    for (const d of g.chart.map((p) => p.date)) if (d < nuo) paskutine = pagalData.get(d) ?? paskutine
    return {
      key: g.code,
      name: g.name,
      color: SPALVOS[i % SPALVOS.length],
      points: datos.map((d) => {
        const verte = pagalData.get(d)
        if (verte !== undefined) paskutine = verte
        return d < pirma ? null : paskutine
      }),
    }
  })

  if (serijos.length > 1) {
    serijos.push({
      key: 'viso',
      name: 'Iš viso',
      color: 'var(--tekstas)',
      storas: true,
      points: datos.map((_, i) =>
        serijos.reduce((s, serija) => s + (serija.points[i] ?? 0), 0)
      ),
    })
  }

  // Ašies žymos: apie 6, mėnesių pavadinimais.
  const zingsnis = Math.max(1, Math.ceil(datos.length / 6))
  const zymos = datos
    .map((d, i) => ({ i, tekstas: menuoVardas(d.slice(0, 7), true) }))
    .filter((_, i) => i % zingsnis === 0)

  return { serijos, pavadinimai: datos, zymos }
}

type Props = {
  duomenys: TaupymoDuomenys
  onChanged: () => void
}

const TIPAI: Record<TaupymoTikslas['kind'], string> = {
  rezervas: 'rezervas',
  investicijos: 'investicijos',
  tikslas: 'tikslas',
}

const IRASO_TIPAI: Record<string, string> = {
  inasas: 'įnašas',
  isemimas: 'išėmimas',
  palukanos: 'palūkanos',
}

/** „+10,25 %" — grąža procentais šalia piniginės išraiškos. */
const proc = (pct: number | null) =>
  pct === null ? '' : `${pct > 0 ? '+' : ''}${pct.toLocaleString('lt-LT', { maximumFractionDigits: 2 })} %`

const centai = (tekstas: string): number | null => {
  const skaicius = Number(tekstas.replace(',', '.'))
  return Number.isFinite(skaicius) ? Math.round(skaicius * 100) : null
}

function Rodiklis({ etikete, reiksme, pastaba }: { etikete: string; reiksme: string; pastaba?: string }) {
  return (
    <div className="rodiklis">
      <span className="rodiklis-etikete">{etikete}</span>
      <strong className="rodiklis-reiksme">{reiksme}</strong>
      {pastaba && <span className="rodiklis-pastaba">{pastaba}</span>}
    </div>
  )
}

/**
 * Taupymo ir investicijų skiltis: katiliukai, jų sukauptos sumos, tikslai ir dar
 * nepriskirti vidiniai pervedimai. Nieko naujo nesaugoma — pervedimai lieka savo
 * vietoje, čia tik pažymima, kuriam tikslui jie skirti.
 */
export default function Taupymas({ duomenys, onChanged }: Props) {
  const [klaida, setKlaida] = useState<string | null>(null)
  const [dirba, setDirba] = useState(false)
  const [naujasTikslas, setNaujasTikslas] = useState(false)
  const [visiKandidatai, setVisiKandidatai] = useState(false)
  const [kryptys, setKryptys] = useState<Record<number, string>>({})

  const { totals: s } = duomenys

  // Taupymo priminimai gyvena čia, o ne apžvalgoje, kad pradinis langas rodytų
  // tik būtinus mokėjimus. Logika ta pati — imama iš to paties API.
  const [priminimai, setPriminimai] = useState<PriminimuDuomenys | null>(null)
  const loadPriminimus = () => {
    api
      .reminders()
      .then(setPriminimai)
      .catch(() => setPriminimai(null))
  }

  useEffect(loadPriminimus, [])

  const perkrauti = () => {
    onChanged()
    loadPriminimus()
  }

  async function veiksmas(darbas: () => Promise<unknown>) {
    setDirba(true)
    setKlaida(null)
    try {
      await darbas()
      perkrauti()
    } catch (err) {
      setKlaida(err instanceof Error ? err.message : 'Nepavyko išsaugoti.')
    } finally {
      setDirba(false)
    }
  }

  /** Kryptis spėjama iš ženklo, bet vartotojas gali ją pakeisti. */
  const kryptis = (c: TaupymoKandidatas) => kryptys[c.id] ?? (c.centsIfAssigned < 0 ? 'isemimas' : 'inasas')

  const priskirti = (kandidatas: TaupymoKandidatas, code: string) =>
    veiksmas(() => api.addSavingsEntry(code, { transactionId: kandidatas.id, kind: kryptis(kandidatas) }))

  const [periodas, setPeriodas] = useState<number | null>(12)
  const grafikas = useMemo(
    () => portfelioSerijos(duomenys.goals, periodas === null ? '' : priesMenesius(duomenys.today, periodas)),
    [duomenys.goals, duomenys.today, periodas]
  )

  /** Visi fondai su naujausiomis kainomis — po vieną kiekvienam simboliui. */
  const kainos = useMemo(() => {
    const pagalSimboli = new Map<string, TaupymoTikslas['funds'][number]>()
    for (const g of duomenys.goals) for (const f of g.funds) if (!pagalSimboli.has(f.symbol)) pagalSimboli.set(f.symbol, f)
    return [...pagalSimboli.values()]
  }, [duomenys.goals])

  const klaidosKainose = duomenys.priceUpdate?.results.filter((r) => !r.ok) ?? []

  const siulomi = duomenys.candidates.filter((c) => c.suggestedCode !== null)
  // Vidinių pervedimų daug (pinigai tarp savo sąskaitų, bendros išlaidos), tad
  // pirma rodomi tik tie, kuriems yra pasiūlymas.
  const rodomiKandidatai = visiKandidatai || siulomi.length === 0 ? duomenys.candidates : siulomi

  return (
    <div className="kreditai taupymas">
      <div className="kreditu-suvestine">
        <Rodiklis
          etikete="Sukaupta iš viso"
          reiksme={eur(s.valueCents)}
          pastaba={`${duomenys.goals.length} katiliukai`}
        />
        <Rodiklis
          etikete={`Atidėta ${menuoVardas(duomenys.month)}`}
          reiksme={eur(s.thisMonthCents)}
          pastaba={s.monthlyPlanCents > 0 ? `planas ${eur(s.monthlyPlanCents)} / mėn.` : undefined}
        />
        <Rodiklis
          etikete="Investuota / grynaisiais"
          reiksme={eur(s.fundsValueCents)}
          pastaba={`dar neinvestuota ${eur(s.cashCents)}`}
        />
        {s.gainCents !== null && (
          <Rodiklis
            etikete="Uždirbta"
            reiksme={`${eur(s.gainCents)}${s.gainPct === null ? '' : ` · ${proc(s.gainPct)}`}`}
            pastaba="rinkos vertė prieš investuotą sumą"
          />
        )}
        {s.interestCents > 0 && (
          <Rodiklis etikete="Palūkanos" reiksme={eur(s.interestCents)} pastaba="indėlio palūkanos" />
        )}
        {s.unassignedCount > 0 && (
          <Rodiklis
            etikete="Nepriskirti pervedimai"
            reiksme={String(s.unassignedCount)}
            pastaba={siulomi.length > 0 ? `${siulomi.length} su pasiūlymu` : 'peržiūrėk žemiau'}
          />
        )}
      </div>

      {klaida && <p className="error">{klaida}</p>}

      {grafikas && (
        <section className="kreditu-ivykiai taupymo-grafikas">
          <div className="lenteles-irankiai">
            <h3>Portfelio vertė</h3>
            <div className="perjungiklis" role="group" aria-label="Laikotarpis">
              {PERIODAI.map(([tekstas, menesiai]) => (
                <button
                  key={tekstas}
                  type="button"
                  aria-pressed={periodas === menesiai}
                  onClick={() => setPeriodas(menesiai)}
                >
                  {tekstas}
                </button>
              ))}
            </div>
          </div>
          <LinijuGrafikas
            serijos={grafikas.serijos}
            pavadinimai={grafikas.pavadinimai}
            zymos={grafikas.zymos}
            ariaLabel="Investicijų portfelio vertė"
          />
        </section>
      )}

      {kainos.length > 0 && (
        <section className="kreditu-ivykiai taupymo-kainos">
          <div className="lenteles-irankiai">
            <h3>ETF kainos</h3>
            <button
              className="ghost small"
              disabled={dirba}
              onClick={() => veiksmas(() => api.refreshSavingsPrices())}
            >
              atnaujinti kainas
            </button>
          </div>
          <ul>
            {kainos.map((f) => (
              <li key={f.symbol}>
                <span className="ivykio-data">{f.symbol}</span>
                <span className="ivykio-pavadinimas">
                  {f.name}
                  {f.price !== null && (
                    <strong>
                      {' '}
                      · {f.price.toLocaleString('lt-LT', { minimumFractionDigits: 2 })} €
                    </strong>
                  )}
                </span>
                <span className="ivykio-kada">{f.priceDate ?? 'kainos dar nėra'}</span>
              </li>
            ))}
          </ul>
          {duomenys.refreshingPrices && <p className="paaiskinimas">Kainos atnaujinamos fone…</p>}
          {klaidosKainose.length > 0 && (
            <p className="error">
              Nepavyko atnaujinti: {klaidosKainose.map((r) => `${r.symbol} — ${r.error}`).join('; ')}
            </p>
          )}
        </section>
      )}

      {priminimai && <Priminimai duomenys={priminimai} rodyti="taupymas" onChanged={perkrauti} />}

      {duomenys.candidates.length > 0 && (
        <section className="kreditu-ivykiai taupymo-kandidatai">
          <h3>Nepriskirti vidiniai pervedimai</h3>
          <p className="paaiskinimas">
            Šie pervedimai į pajamas ir išlaidas neįeina. Priskyrus katiliukui jie tampa įnašu arba išėmimu —
            pati operacija lieka savo vietoje. Kryptį patikrink: pervedimas kitam žmogui gali būti ir
            sutaupytų pinigų panaudojimas.
          </p>
          {siulomi.length > 0 && siulomi.length < duomenys.candidates.length && (
            <button className="ghost small" onClick={() => setVisiKandidatai(!visiKandidatai)}>
              {visiKandidatai
                ? `rodyti tik su pasiūlymu (${siulomi.length})`
                : `rodyti visus pervedimus (${duomenys.candidates.length})`}
            </button>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Pervedimas</th>
                  <th className="num">Suma</th>
                  <th>Kryptis</th>
                  <th>Katiliukas</th>
                </tr>
              </thead>
              <tbody>
                {rodomiKandidatai.map((c) => (
                  <tr key={c.id}>
                    <td className="nowrap">{c.date}</td>
                    <td>
                      {c.description?.split(',')[0] ?? c.counterpartyName ?? '—'}
                      <small className="po-tekstu">
                        {c.accountOwner}
                        {c.ibanLast4 ? ` ···${c.ibanLast4}` : ''}
                      </small>
                    </td>
                    <td className={kryptis(c) === 'isemimas' ? 'num neigiamas' : 'num'}>
                      {eur(kryptis(c) === 'isemimas' ? -Math.abs(c.centsIfAssigned) : Math.abs(c.centsIfAssigned))}
                    </td>
                    <td className="nowrap">
                      <select
                        value={kryptis(c)}
                        disabled={dirba}
                        onChange={(e) => setKryptys((k) => ({ ...k, [c.id]: e.target.value }))}
                        aria-label="Įnašas ar išėmimas"
                      >
                        <option value="inasas">įnašas</option>
                        <option value="isemimas">išėmimas</option>
                      </select>
                    </td>
                    <td className="nowrap">
                      <select
                        defaultValue={c.suggestedCode ?? ''}
                        disabled={dirba}
                        onChange={(e) => e.target.value && priskirti(c, e.target.value)}
                        aria-label="Kuriam katiliukui"
                      >
                        <option value="">— pasirink —</option>
                        {duomenys.goals.map((g) => (
                          <option key={g.code} value={g.code}>
                            {g.name}
                          </option>
                        ))}
                      </select>
                      {c.suggestedCode && (
                        <button
                          className="ghost small"
                          disabled={dirba}
                          onClick={() => priskirti(c, c.suggestedCode!)}
                        >
                          priskirti „{c.suggestedName}“
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {duomenys.goals.map((g) => (
        <Katiliukas key={g.code} tikslas={g} dirba={dirba} veiksmas={veiksmas} />
      ))}

      <section className="taupymo-naujas">
        {!naujasTikslas ? (
          <button className="ghost small" onClick={() => setNaujasTikslas(true)}>
            + naujas taupymo tikslas
          </button>
        ) : (
          <NaujasTikslas
            dirba={dirba}
            onClose={() => setNaujasTikslas(false)}
            onSave={async (body) => {
              await veiksmas(() => api.createSavingsGoal(body))
              setNaujasTikslas(false)
            }}
          />
        )}
      </section>
    </div>
  )
}

function Katiliukas({
  tikslas: g,
  dirba,
  veiksmas,
}: {
  tikslas: TaupymoTikslas
  dirba: boolean
  veiksmas: (darbas: () => Promise<unknown>) => Promise<void>
}) {
  const [verte, setVerte] = useState('')
  const [verteData, setVerteData] = useState(() => new Date().toISOString().slice(0, 10))
  const [suma, setSuma] = useState('')
  const [sumosData, setSumosData] = useState(() => new Date().toISOString().slice(0, 10))
  const [tipas, setTipas] = useState('inasas')
  const [pirkimoData, setPirkimoData] = useState(() => new Date().toISOString().slice(0, 10))
  const [pirkimoFondas, setPirkimoFondas] = useState(() => g.funds[0]?.symbol ?? '')
  const [vienetai, setVienetai] = useState('')
  const [kaina, setKaina] = useState('')
  /** Įrašas, už kurį perkami vienetai — suma jau žinoma, lieka tik kiekis. */
  const [investuojamas, setInvestuojamas] = useState<{ date: string; cents: number } | null>(null)
  const [investuotiFondas, setInvestuotiFondas] = useState(() => g.funds[0]?.symbol ?? '')
  const [investuotiVienetai, setInvestuotiVienetai] = useState('')

  const progresas = g.progress === null ? null : Math.min(1, Math.max(0, g.progress))

  return (
    <section className="kreditas taupymo-kortele">
      <header className="taupymo-antraste">
        <div>
          <h3>{g.name}</h3>
          <small>
            {g.owner} · {TIPAI[g.kind]}
            {g.whereKept ? ` · ${g.whereKept}` : ''}
          </small>
        </div>
        <div className="taupymo-suma">
          <strong>{eur(g.valueCents)}</strong>
          {g.valueEstimated && <span className="tag">su vėlesniais įnašais</span>}
        </div>
      </header>

      {progresas !== null && g.targetCents !== null && (
        <div className="taupymo-progresas">
          <div className="taupymo-juosta">
            <span style={{ width: `${progresas * 100}%` }} />
          </div>
          <small>
            {eur(g.valueCents)} iš {eur(g.targetCents)} · liko {eur(g.leftCents ?? 0)}
            {g.monthsLeft !== null && g.neededMonthlyCents !== null
              ? ` · ${g.monthsLeft} mėn. po ${eur(g.neededMonthlyCents)}`
              : ''}
          </small>
        </div>
      )}

      <dl className="taupymo-faktai">
        <div>
          <dt>Įnešta</dt>
          <dd>{eur(g.contributedCents)}</dd>
        </div>
        {g.withdrawnCents > 0 && (
          <div>
            <dt>Išimta</dt>
            <dd>{eur(g.withdrawnCents)}</dd>
          </div>
        )}
        {g.interestCents > 0 && (
          <div>
            <dt>Palūkanos</dt>
            <dd>{eur(g.interestCents)}</dd>
          </div>
        )}
        <div>
          <dt>Šį mėnesį</dt>
          <dd>
            {eur(g.thisMonthCents)}
            {g.monthlyPlanCents ? <small>planas {eur(g.monthlyPlanCents)}</small> : null}
          </dd>
        </div>
        {g.gainCents !== null ? (
          <div>
            <dt>Uždirbta</dt>
            <dd className={g.gainCents < 0 ? 'neigiamas' : 'income'}>{eur(g.gainCents)}</dd>
          </div>
        ) : (
          g.kind === 'investicijos' && (
            <div>
              <dt>Uždirbta</dt>
              <dd>
                —<small>įvesk tikrą portfelio vertę</small>
              </dd>
            </div>
          )
        )}
      </dl>

      {g.note && <p className="paaiskinimas">{g.note}</p>}

      {g.funds.length > 0 && (
        <div className="taupymo-fondai">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Fondas</th>
                  <th className="num">Vienetai</th>
                  <th className="num">Kaina</th>
                  <th className="num">Vertė</th>
                  <th className="num">Investuota</th>
                  <th className="num">Uždirbta</th>
                </tr>
              </thead>
              <tbody>
                {g.funds.map((f) => (
                  <tr key={f.id}>
                    <td>
                      {f.symbol}
                      <small className="po-tekstu">{f.name}</small>
                    </td>
                    <td className="num">{f.units.toLocaleString('lt-LT', { maximumFractionDigits: 6 })}</td>
                    <td className="num">
                      {f.price === null ? '—' : `${f.price.toLocaleString('lt-LT', { minimumFractionDigits: 2 })} €`}
                      {f.priceDate && <small className="po-tekstu">{f.priceDate}</small>}
                    </td>
                    <td className="num">{eur(f.valueCents)}</td>
                    <td className="num">{eur(f.investedCents)}</td>
                    <td className={f.gainCents !== null && f.gainCents < 0 ? 'num neigiamas' : 'num income'}>
                      {f.gainCents === null ? '—' : eur(f.gainCents)}
                      {f.gainPct !== null && <small className="po-tekstu">{proc(f.gainPct)}</small>}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td>
                    Grynieji
                    <small className="po-tekstu">dar neinvestuota</small>
                  </td>
                  <td className="num">—</td>
                  <td className="num">—</td>
                  <td className={g.cashCents < 0 ? 'num neigiamas' : 'num'}>{eur(g.cashCents)}</td>
                  <td className="num">—</td>
                  <td className="num">—</td>
                </tr>
                <tr className="likutis">
                  <td>Iš viso</td>
                  <td className="num">—</td>
                  <td className="num">—</td>
                  <td className="num">{eur(g.valueCents)}</td>
                  <td className="num">{eur(g.investedCents)}</td>
                  <td className={g.gainCents !== null && g.gainCents < 0 ? 'num neigiamas' : 'num income'}>
                    {g.gainCents === null ? '—' : eur(g.gainCents)}
                    {g.gainPct !== null && <small className="po-tekstu">{proc(g.gainPct)}</small>}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          {g.cashCents !== 0 && (
            <p className="paaiskinimas">
              Dar neinvestuota: {eur(g.cashCents)}
              {g.cashCents < 0 && ' — pirkimų suma didesnė nei priskirtų įnašų, trūksta priskirto pervedimo.'}
            </p>
          )}

          <details className="kreditas-skyrius">
            <summary>
              Pirkimai <span>{g.funds.reduce((s, f) => s + f.purchases.length, 0)}</span>
            </summary>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Fondas</th>
                    <th className="num">Vienetai</th>
                    <th className="num">Kaina</th>
                    <th className="num">Suma</th>
                    <th className="tight"></th>
                  </tr>
                </thead>
                <tbody>
                  {g.funds
                    .flatMap((f) => f.purchases.map((p) => ({ ...p, symbol: f.symbol })))
                    .sort((a, b) => b.date.localeCompare(a.date))
                    .map((p) => (
                      <tr key={p.id}>
                        <td className="nowrap">{p.date}</td>
                        <td>{p.symbol}</td>
                        <td className="num">{p.units.toLocaleString('lt-LT', { maximumFractionDigits: 8 })}</td>
                        <td className="num">{p.unitPrice.toLocaleString('lt-LT', { minimumFractionDigits: 2 })} €</td>
                        <td className="num">{eur(p.cents)}</td>
                        <td className="tight">
                          {p.source === 'rankinis' && (
                            <button
                              className="ghost small"
                              disabled={dirba}
                              onClick={() => {
                                if (confirm('Ištrinti šį pirkimą?')) veiksmas(() => api.deleteSavingsPurchase(p.id))
                              }}
                            >
                              trinti
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            <div className="taupymo-forma">
              <label>
                Data
                <input type="date" value={pirkimoData} onChange={(e) => setPirkimoData(e.target.value)} />
              </label>
              <label>
                Fondas
                <select value={pirkimoFondas} onChange={(e) => setPirkimoFondas(e.target.value)}>
                  {g.funds.map((f) => (
                    <option key={f.id} value={f.symbol}>
                      {f.symbol}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Vienetai
                <input
                  type="text"
                  inputMode="decimal"
                  value={vienetai}
                  placeholder="pvz. 1,48667935"
                  onChange={(e) => setVienetai(e.target.value)}
                />
              </label>
              <label>
                Vieneto kaina, €
                <input
                  type="text"
                  inputMode="decimal"
                  value={kaina}
                  placeholder="pvz. 168,16"
                  onChange={(e) => setKaina(e.target.value)}
                />
              </label>
              <button
                className="ghost small"
                disabled={dirba || vienetai.trim() === '' || kaina.trim() === ''}
                onClick={async () => {
                  const u = Number(vienetai.replace(',', '.'))
                  const k = Number(kaina.replace(',', '.'))
                  if (!Number.isFinite(u) || !Number.isFinite(k) || u <= 0 || k <= 0) return
                  await veiksmas(() =>
                    api.addSavingsPurchase(g.code, {
                      symbol: pirkimoFondas || g.funds[0].symbol,
                      date: pirkimoData,
                      units: u,
                      unitPrice: k,
                    })
                  )
                  setVienetai('')
                  setKaina('')
                }}
              >
                pridėti pirkimą
              </button>
            </div>
            <p className="paaiskinimas">
              Suma suskaičiuojama iš vienetų ir kainos. Pinigai į katiliuką patenka atskirai — priskyrus
              pervedimą viršuje.
            </p>
          </details>
        </div>
      )}

      <details className="kreditas-skyrius">
        <summary>
          Įrašai <span>{g.entries.length}</span>
        </summary>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th className="num">Suma</th>
                <th>Kas tai</th>
                <th className="tight"></th>
              </tr>
            </thead>
            <tbody>
              {g.entries.map((e) => (
                <tr key={e.id}>
                  <td className="nowrap">{e.date}</td>
                  <td className={e.cents < 0 ? 'num neigiamas' : 'num'}>{eur(e.cents)}</td>
                  <td>
                    {IRASO_TIPAI[e.kind] ?? e.kind}
                    <small className="po-tekstu">{e.note ?? e.source}</small>
                  </td>
                  <td className="tight nowrap">
                    {g.funds.length > 0 && e.cents > 0 && (
                      <button
                        className="ghost small"
                        disabled={dirba}
                        onClick={() => setInvestuojamas({ date: e.date, cents: e.cents })}
                        title="Nupirkta fondo vienetų už šią sumą"
                      >
                        investuoti
                      </button>
                    )}{' '}
                    {(e.source === 'rankinis' || e.source === 'pervedimas') && (
                      <button
                        className="ghost small"
                        disabled={dirba}
                        onClick={() => {
                          if (confirm('Pašalinti šį įrašą iš katiliuko?')) {
                            veiksmas(() => api.deleteSavingsEntry(e.id))
                          }
                        }}
                      >
                        pašalinti
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {investuojamas && (
          <div className="taupymo-forma nauja">
            <span className="paaiskinimas">
              Investuojama {eur(investuojamas.cents)} ({investuojamas.date}). Įvesk, kiek vienetų nupirkta —
              vieneto kaina suskaičiuojama pati.
            </span>
            <label>
              Fondas
              <select value={investuotiFondas} onChange={(e) => setInvestuotiFondas(e.target.value)}>
                {g.funds.map((f) => (
                  <option key={f.id} value={f.symbol}>
                    {f.symbol}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Vienetai
              <input
                type="text"
                inputMode="decimal"
                value={investuotiVienetai}
                placeholder="pvz. 1,48667935"
                onChange={(e) => setInvestuotiVienetai(e.target.value)}
              />
            </label>
            <button
              className="ghost small"
              disabled={dirba || investuotiVienetai.trim() === ''}
              onClick={async () => {
                const u = Number(investuotiVienetai.replace(',', '.'))
                if (!Number.isFinite(u) || u <= 0) return
                await veiksmas(() =>
                  api.addSavingsPurchase(g.code, {
                    symbol: investuotiFondas || g.funds[0].symbol,
                    date: investuojamas.date,
                    units: u,
                    unitPrice: investuojamas.cents / 100 / u,
                    cents: investuojamas.cents,
                  })
                )
                setInvestuotiVienetai('')
                setInvestuojamas(null)
              }}
            >
              investuoti
            </button>
            <button className="ghost small" onClick={() => setInvestuojamas(null)}>
              atšaukti
            </button>
          </div>
        )}

        <div className="taupymo-forma">
          <label>
            Data
            <input type="date" value={sumosData} onChange={(e) => setSumosData(e.target.value)} />
          </label>
          <label>
            Suma, €
            <input
              type="text"
              inputMode="decimal"
              value={suma}
              placeholder="pvz. 250"
              onChange={(e) => setSuma(e.target.value)}
            />
          </label>
          <label>
            Kas tai
            <select value={tipas} onChange={(e) => setTipas(e.target.value)}>
              <option value="inasas">įnašas</option>
              <option value="isemimas">išėmimas</option>
              <option value="palukanos">palūkanos</option>
            </select>
          </label>
          <button
            className="ghost small"
            disabled={dirba || suma.trim() === ''}
            onClick={async () => {
              const c = centai(suma)
              if (c === null || c === 0) return
              await veiksmas(() =>
                api.addSavingsEntry(g.code, {
                  date: sumosData,
                  cents: tipas === 'isemimas' ? -Math.abs(c) : Math.abs(c),
                  kind: tipas,
                })
              )
              setSuma('')
            }}
          >
            pridėti ranka
          </button>
        </div>
      </details>

      <details className="kreditas-skyrius">
        <summary>
          Tikros vertės <span>{g.lastValuation ? `paskutinė ${g.lastValuation.date}` : 'dar neįvesta'}</span>
        </summary>
        <p className="paaiskinimas">
          Įvedus tikrą likutį ar ETF portfelio vertę, nuo jos skaičiuojama toliau, o skirtumas tarp vertės ir
          įnašų rodomas kaip uždirbta.
        </p>
        {g.valuations.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th className="num">Vertė</th>
                  <th className="tight"></th>
                </tr>
              </thead>
              <tbody>
                {g.valuations.map((v) => (
                  <tr key={v.id}>
                    <td className="nowrap">{v.date}</td>
                    <td className="num">{eur(v.valueCents)}</td>
                    <td className="tight">
                      {v.source !== 'excel' && (
                        <button
                          className="ghost small"
                          disabled={dirba}
                          onClick={() => veiksmas(() => api.deleteSavingsValue(v.id))}
                        >
                          trinti
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="taupymo-forma">
          <label>
            Data
            <input type="date" value={verteData} onChange={(e) => setVerteData(e.target.value)} />
          </label>
          <label>
            Vertė, €
            <input
              type="text"
              inputMode="decimal"
              value={verte}
              placeholder="pvz. 1010,50"
              onChange={(e) => setVerte(e.target.value)}
            />
          </label>
          <button
            className="ghost small"
            disabled={dirba || verte.trim() === ''}
            onClick={async () => {
              const c = centai(verte)
              if (c === null) return
              await veiksmas(() => api.addSavingsValue(g.code, { date: verteData, valueCents: c }))
              setVerte('')
            }}
          >
            įvesti vertę
          </button>
        </div>
      </details>

      {g.history.length > 0 && (
        <details className="kreditas-skyrius">
          <summary>
            Pagal mėnesius <span>{g.history.length} mėn.</span>
          </summary>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Mėnuo</th>
                  <th className="num">Pokytis</th>
                  <th className="num">Sukaupta</th>
                </tr>
              </thead>
              <tbody>
                {[...g.history].reverse().map((h) => (
                  <tr key={h.month}>
                    <td className="nowrap">{menuoVardas(h.month)}</td>
                    <td className={h.cents < 0 ? 'num neigiamas' : 'num'}>{eur(h.cents)}</td>
                    <td className="num">{eur(h.balanceCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  )
}

function NaujasTikslas({
  dirba,
  onClose,
  onSave,
}: {
  dirba: boolean
  onClose: () => void
  onSave: (body: {
    name: string
    owner: string
    kind: string
    whereKept?: string | null
    targetCents?: number | null
    monthlyPlanCents?: number | null
  }) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [owner, setOwner] = useState('Bendra')
  const [kind, setKind] = useState('tikslas')
  const [whereKept, setWhereKept] = useState('')
  const [target, setTarget] = useState('')
  const [planas, setPlanas] = useState('')
  const { nariai } = useNariai()

  return (
    <div className="taupymo-forma nauja">
      <label>
        Pavadinimas
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="pvz. Naujas kompiuteris" />
      </label>
      <label>
        Kieno
        <select value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option>Bendra</option>
          {nariai.map((n) => (
            <option key={n.id}>{n.name}</option>
          ))}
        </select>
      </label>
      <label>
        Tipas
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="tikslas">tikslas</option>
          <option value="rezervas">rezervas</option>
          <option value="investicijos">investicijos</option>
        </select>
      </label>
      <label>
        Kur laikoma
        <input type="text" value={whereKept} onChange={(e) => setWhereKept(e.target.value)} placeholder="pvz. Revolut" />
      </label>
      <label>
        Tikslas, €
        <input type="text" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
      </label>
      <label>
        Planas per mėn., €
        <input type="text" inputMode="decimal" value={planas} onChange={(e) => setPlanas(e.target.value)} />
      </label>
      <button
        className="ghost small"
        disabled={dirba || name.trim() === ''}
        onClick={() =>
          onSave({
            name: name.trim(),
            owner,
            kind,
            whereKept: whereKept.trim() || null,
            targetCents: centai(target),
            monthlyPlanCents: centai(planas),
          })
        }
      >
        sukurti
      </button>
      <button className="ghost small" onClick={onClose}>
        atšaukti
      </button>
    </div>
  )
}
