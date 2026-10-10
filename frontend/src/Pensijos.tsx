import { Fragment, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, eur, menuoVardas, type Pensijos as PensijuDuomenys, type PensijuProduktas } from './api'
import PensijuGrafikas, { SERIJU_SPALVOS } from './PensijuGrafikas'

type Props = {
  duomenys: PensijuDuomenys
  onChanged: () => Promise<unknown>
}

const PAKOPA: Record<string, string> = { II: 'II pakopa', III: 'III pakopa', PZU: 'Gyvybės draudimas' }

const procentai = (x: number, skaitmenys = 1) =>
  `${(x * 100).toLocaleString('lt-LT', { minimumFractionDigits: skaitmenys, maximumFractionDigits: skaitmenys })} %`

const suZenklu = (cents: number) => `${cents >= 0 ? '+' : '−'}${eur(Math.abs(cents))}`

const procentaiSuZenklu = (x: number) => `${x >= 0 ? '+' : '−'}${procentai(Math.abs(x))}`

function trukme(menesiai: number) {
  const metai = Math.floor(menesiai / 12)
  const men = menesiai % 12
  return [metai ? `${metai} m.` : '', men ? `${men} mėn.` : ''].filter(Boolean).join(' ') || 'mažiau nei mėnuo'
}

const pavadinimas = (p: PensijuProduktas) =>
  p.pillar === 'PZU' ? `${p.owner} · gyvybės draudimas (PZU)` : `${p.owner} · ${PAKOPA[p.pillar]}`

/** Sukaupta vertė po `menesiai` mėnesių, kas mėnesį įmokant `imoka` (sudėtinė grąža). */
export function ateitiesVerte(verte: number, imoka: number, menesiai: number, metineGraza: number) {
  const menesine = Math.pow(1 + metineGraza, 1 / 12) - 1
  const augimas = Math.pow(1 + menesine, menesiai)
  const imokos = menesine === 0 ? imoka * menesiai : (imoka * (augimas - 1)) / menesine
  return Math.round(verte * augimas + imokos)
}

/** „7 105,52" arba „7105.52" -> centai; null — tuščia, NaN — neteisinga. */
function centai(tekstas: string) {
  const s = tekstas.replace(/[\s €]/g, '').replace(',', '.')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : NaN
}

function laikas(iso: string) {
  const d = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`)
  return d.toLocaleString('lt-LT', { dateStyle: 'short', timeStyle: 'short' })
}

/**
 * Pensijų skiltis grupės „Pensijos" ekrane: suvestinė, fondų kainų būsena,
 * sukauptos sumos grafikas, produktų kortelės pagal žmones, GPM grąža, prognozė
 * ir PZU draudimai.
 */
export default function Pensijos({ duomenys: d, onChanged }: Props) {
  const [atnaujinimas, setAtnaujinimas] = useState(false)

  const kaupimas = d.products.filter((p) => p.pillar !== 'PZU')
  const pzu = d.products.filter((p) => p.pillar === 'PZU')
  const spalva = (code: string) => {
    const i = d.history.series.findIndex((s) => s.code === code)
    return i >= 0 ? SERIJU_SPALVOS[i] : 'var(--silpnas)'
  }

  const viso = kaupimas.reduce((s, p) => s + (p.valueCents ?? 0), 0)
  const per12 = kaupimas.reduce((s, p) => s + (p.last12.gainCents ?? 0), 0)
  const imokos = kaupimas.reduce((s, p) => s + (p.monthlyContributionCents ?? 0), 0)
  const gpm = useMemo(() => gpmPagalMoketoja(d), [d])
  const apytiksliai = kaupimas.some((p) => p.valueEstimated)

  return (
    <div className="kreditai pensijos">
      <div className="kreditu-suvestine">
        <Rodiklis etikete="Sukaupta pensijai" reiksme={eur(viso)} pastaba={`II ir III pakopa${apytiksliai ? ', dalis apytiksliai' : ''}`} />
        <Rodiklis etikete="Uždirbta per 12 mėn." reiksme={suZenklu(per12)} pastaba="vertės pokytis be įmokų" />
        <Rodiklis etikete="Įmokos per mėnesį" reiksme={`~${eur(imokos)}`} pastaba="Sodros ir savos kartu" />
        <Rodiklis
          etikete={`GPM grąža už ${d.gpm.year} m.`}
          reiksme={`~${eur(gpm.reduce((s, g) => s + g.graza, 0))}`}
          pastaba={`už III pakopą ir PZU, deklaruoti iki ${d.gpm.deadline}`}
        />
      </div>

      <KainuBusena duomenys={d} onChanged={onChanged} onIvesti={() => setAtnaujinimas(true)} />

      <section className="kreditas">
        <div className="grafiko-antraste">
          <h3>Sukaupta suma laike</h3>
          <span>mėnesio pabaigos vertės</span>
        </div>
        <PensijuGrafikas menesiai={d.history.months} serijos={d.history.series} />
        <VerciuLentele duomenys={d} />
      </section>

      {d.people.map((zmogus) => {
        const produktai = kaupimas.filter((p) => p.owner === zmogus.owner)
        if (produktai.length === 0) return null
        return (
          <section key={zmogus.owner} className="pensiju-zmogus">
            <header>
              <h3>{zmogus.owner}</h3>
              <span>
                {eur(zmogus.valueCents)} · pensinis amžius {zmogus.payoutDate.slice(0, 4)} m. (liko{' '}
                {trukme(zmogus.monthsToPayout)})
              </span>
            </header>
            <div className="pensiju-korteles">
              {produktai.map((p) => (
                <ProduktoKortele key={p.code} produktas={p} spalva={spalva(p.code)} onChanged={onChanged} />
              ))}
            </div>
          </section>
        )
      })}

      <GpmKortele duomenys={d} eilutes={gpm} />
      <Prognoze duomenys={d} />
      {pzu.length > 0 && <PzuKortele produktai={pzu} onChanged={onChanged} onIvesti={() => setAtnaujinimas(true)} />}

      {atnaujinimas && (
        <AtnaujinimoDialogas
          duomenys={d}
          onClose={() => setAtnaujinimas(false)}
          onSaved={async () => {
            setAtnaujinimas(false)
            await onChanged()
          }}
        />
      )}
    </div>
  )
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

function Faktas({ pavadinimas, reiksme, pastaba }: { pavadinimas: string; reiksme: string; pastaba?: string }) {
  return (
    <div>
      <dt>{pavadinimas}</dt>
      <dd>
        {reiksme}
        {pastaba && <small>{pastaba}</small>}
      </dd>
    </div>
  )
}

function KainuBusena({
  duomenys: d,
  onChanged,
  onIvesti,
}: {
  duomenys: PensijuDuomenys
  onChanged: () => Promise<unknown>
  onIvesti: () => void
}) {
  const [kraunama, setKraunama] = useState(false)
  const [klaida, setKlaida] = useState<string | null>(null)
  const nepavyko = d.priceUpdate?.results.filter((r) => !r.ok) ?? []

  async function atnaujinti() {
    setKraunama(true)
    setKlaida(null)
    try {
      await api.refreshPensionPrices()
      await onChanged()
    } catch (err) {
      setKlaida(err instanceof Error ? err.message : 'Nepavyko atnaujinti kainų.')
    } finally {
      setKraunama(false)
    }
  }

  return (
    <section className="pensiju-kainos">
      <div className="pensiju-kainos-virsus">
        <div>
          <strong>Fondų kainos</strong>
          <span>
            {kraunama || (d.refreshingPrices && !d.priceUpdate)
              ? 'atnaujinamos iš SEB ir Swedbank…'
              : d.priceUpdate
                ? `automatiškai patikrinta ${laikas(d.priceUpdate.updatedAt)}`
                : 'dar neatnaujintos'}
          </span>
        </div>
        <div className="pensiju-mygtukai">
          <button className="ghost small" onClick={atnaujinti} disabled={kraunama}>
            {kraunama ? 'Atnaujinama...' : 'Atnaujinti kainas'}
          </button>
          <button className="small" onClick={onIvesti}>
            Įvesti vertes
          </button>
        </div>
      </div>

      {klaida && <p className="error">{klaida}</p>}
      {nepavyko.length > 0 && (
        <p className="error">
          Nepavyko gauti kainų:{' '}
          {nepavyko.map((r) => `${r.fundName} (${r.provider}: ${r.error})`).join('; ')}. Rodoma paskutinė žinoma kaina.
        </p>
      )}

      <details className="kreditas-skyrius">
        <summary>
          Fondai ir jų grąža
          <span>{d.funds.length} fondai</span>
        </summary>
        <div className="table-wrap">
          <table className="kredito-lentele">
            <thead>
              <tr>
                <th>Fondas / kryptis</th>
                <th className="num">Vieneto kaina</th>
                <th className="num">1 m.</th>
                <th className="num">3 m.</th>
                <th className="num">5 m.</th>
              </tr>
            </thead>
            <tbody>
              {d.funds.map((f) => (
                <tr key={f.isin}>
                  <td>
                    {f.fundName}
                    <small className="po-tekstu">{f.isin}</small>
                  </td>
                  <td className="num nowrap">
                    {f.price === null ? '—' : f.price.toLocaleString('lt-LT', { maximumFractionDigits: 4 })}
                    {f.date && <small className="po-tekstu">{f.date}</small>}
                  </td>
                  {[f.returns.y1, f.returns.y3, f.returns.y5].map((r, i) => (
                    <td key={i} className="num nowrap">
                      {r === null ? '—' : procentaiSuZenklu(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="paaiskinimas">
          Kainos paimamos iš viešų SEB ir Swedbank fondų puslapių (kartą per pusę paros atidarius šią skiltį).
          Grąža — vieneto kainos pokytis, be įmokų.
        </p>
      </details>
    </section>
  )
}

function VerciuLentele({ duomenys: d }: { duomenys: PensijuDuomenys }) {
  const menesiai = d.history.months.map((m, i) => ({ m, i })).reverse()
  return (
    <details className="kreditas-skyrius">
      <summary>
        Vertės pagal mėnesius
        <span>nuo {menuoVardas(d.history.months[0] ?? d.today.slice(0, 7))}</span>
      </summary>
      <div className="table-wrap">
        <table className="kredito-lentele">
          <thead>
            <tr>
              <th>Mėnuo</th>
              {d.history.series.map((s) => (
                <th key={s.code} className="num">
                  {s.name}
                </th>
              ))}
              <th className="num">Iš viso</th>
            </tr>
          </thead>
          <tbody>
            {menesiai.map(({ m, i }) => (
              <tr key={m}>
                <td className="nowrap">{menuoVardas(m)}</td>
                {d.history.series.map((s) => (
                  <td key={s.code} className="num">
                    {s.points[i] === null ? '—' : eur(s.points[i] ?? 0)}
                  </td>
                ))}
                <td className="num">
                  <strong>{eur(d.history.series.reduce((sum, s) => sum + (s.points[i] ?? 0), 0))}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

function GrazosJuosta({ produktas: p, spalva }: { produktas: PensijuProduktas; spalva: string }) {
  const r = p.returns
  if (!r || p.valueCents === null) return null
  const l = r.lifetime
  const pradine = l ? 0 : r.startValueCents
  const imoketa = l ? l.contributedCents : r.contributedCents
  const uzdirbta = l ? l.gainCents : r.gainCents
  const nuo = l ? l.since : r.since
  const baze = pradine + imoketa
  const viso = Math.max(1, baze + Math.max(0, uzdirbta))
  const plotis = (c: number) => `${(Math.max(0, c) / viso) * 100}%`

  return (
    <div className="grazos-juosta">
      <div
        className="juosta"
        role="img"
        aria-label={`${pradine > 0 ? `pradinė vertė ${eur(pradine)}, ` : ''}įmokėta ${eur(imoketa)}, uždirbta ${suZenklu(uzdirbta)}`}
      >
        {pradine > 0 && <div className="pradine" style={{ width: plotis(pradine) }} />}
        <div className="imokos" style={{ width: plotis(imoketa) }} />
        {uzdirbta > 0 && <div style={{ width: plotis(uzdirbta), background: spalva }} />}
      </div>
      <div className="grazos-legenda">
        {pradine > 0 && (
          <span>
            <i className="pradine" /> vertė {r.since}: {eur(pradine)}
          </span>
        )}
        <span>
          <i className="imokos" /> įmokėta {eur(imoketa)}
          {l && p.transfersCents > 0 ? ` (su perkeltais ${eur(p.transfersCents)})` : ''}
        </span>
        <span>
          <i style={{ background: spalva }} /> uždirbta <strong>{suZenklu(uzdirbta)}</strong>
          {baze > 0 && ` (${procentaiSuZenklu(uzdirbta / baze)})`}
        </span>
      </div>
      <small className="po-tekstu">{nuo ? `skaičiuojant nuo ${nuo}` : ''}</small>
    </div>
  )
}

function ProduktoKortele({
  produktas: p,
  spalva,
  onChanged,
}: {
  produktas: PensijuProduktas
  spalva: string
  onChanged: () => Promise<unknown>
}) {
  const r = p.returns
  const saltiniai = { ataskaita: 'ataskaita', bankas: 'bankas', excel: 'Excel', apytiksle: 'apytiksliai' } as const

  return (
    <article className="kreditas pensijos-produktas">
      <header className="kreditas-virsus">
        <div>
          <h3>
            <span className="spalvos-zyme" style={{ background: spalva }} /> {PAKOPA[p.pillar]}
          </h3>
          <span className="kreditas-sub">{[p.provider, p.fundLabel].filter(Boolean).join(' · ')}</span>
        </div>
        {p.valueEstimated && (
          <span
            className="tag"
            title="Naujausios įmokos arba kainos dar neatsispindi ataskaitoje — vertė apskaičiuota pagal planą ir fondų kainas."
          >
            apytiksliai
          </span>
        )}
      </header>

      <div className="kreditas-likutis">
        <div>
          <span>Sukaupta</span>
          <strong>{p.valueCents === null ? '—' : eur(p.valueCents)}</strong>
        </div>
        <div className="desine">
          <span>Vertė</span>
          <strong className="pensijos-data">{p.valueDate ?? '—'}</strong>
        </div>
      </div>

      <GrazosJuosta produktas={p} spalva={spalva} />

      <dl className="kreditas-faktai">
        <Faktas
          pavadinimas="Metinė grąža"
          reiksme={r?.xirr != null ? procentaiSuZenklu(r.xirr) : '—'}
          pastaba={r ? `atsižvelgiant į įmokų laiką, nuo ${r.since}` : undefined}
        />
        <Faktas
          pavadinimas="Per 12 mėn."
          reiksme={p.last12.gainCents === null ? '—' : suZenklu(p.last12.gainCents)}
          pastaba={`be įmokų; įmokėta ${eur(p.last12.contributedCents)}`}
        />
        <Faktas
          pavadinimas="Įmoka per mėnesį"
          reiksme={p.monthlyContributionCents ? `~${eur(p.monthlyContributionCents)}` : '—'}
          pastaba={p.pillar === 'II' ? 'iš Sodros, 3 paskutinių vidurkis' : 'pagal sutartį'}
        />
      </dl>

      {p.holdings.length > 0 && (
        <details className="kreditas-skyrius">
          <summary>
            Fondai ir vienetai
            <span>{p.holdings.some((h) => h.estimated) ? 'dalis vienetų apytiksliai' : `kainos ${p.holdings[0].priceDate}`}</span>
          </summary>
          <div className="table-wrap">
            <table className="kredito-lentele">
              <thead>
                <tr>
                  <th>Fondas</th>
                  <th className="num">Vienetai</th>
                  <th className="num">Kaina</th>
                  <th className="num">Vertė</th>
                </tr>
              </thead>
              <tbody>
                {p.holdings.map((h) => (
                  <tr key={`${h.portfolio}-${h.isin}`}>
                    <td>
                      {h.fundName}
                      {h.portfolio && <small className="po-tekstu">{h.portfolio} dalis</small>}
                    </td>
                    <td className="num">
                      {h.units.toLocaleString('lt-LT', { maximumFractionDigits: 4 })}
                      {h.estimated && <small className="po-tekstu">apytiksliai</small>}
                    </td>
                    <td className="num nowrap">
                      {h.price.toLocaleString('lt-LT', { maximumFractionDigits: 4 })}
                      <small className="po-tekstu">{h.priceDate}</small>
                    </td>
                    <td className="num">{eur(h.valueCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {p.contributions.years.length > 0 && (
        <details className="kreditas-skyrius">
          <summary>
            Įmokos
            <span>
              {eur(p.contributions.totalCents)} nuo {p.contributions.since}
            </span>
          </summary>
          <div className="pensiju-imokos">
            <table className="kredito-lentele">
              <thead>
                <tr>
                  <th>Metai</th>
                  <th className="num">Įmokėta</th>
                </tr>
              </thead>
              <tbody>
                {p.contributions.years.map((y) => (
                  <tr key={y.year}>
                    <td>{y.year}</td>
                    <td className="num">{eur(y.cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className="kredito-lentele">
              <thead>
                <tr>
                  <th>Naujausios</th>
                  <th className="num">Suma</th>
                </tr>
              </thead>
              <tbody>
                {p.contributions.recent.map((c, i) => (
                  <tr key={`${c.date}-${i}`}>
                    <td className="nowrap">
                      {c.date} <small className="saltinis">{saltiniai[c.source]}</small>
                    </td>
                    <td className="num">{eur(c.cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {p.contributions.estimatedCents > 0 && (
            <p className="paaiskinimas">
              {eur(p.contributions.estimatedCents)} — apytikslės įmokos pagal planą, kurių dar nėra ataskaitoje.
            </p>
          )}
        </details>
      )}

      {p.valuation === 'rankinis' && <VerciuIstorija produktas={p} onChanged={onChanged} />}

      <details className="kreditas-skyrius">
        <summary>Sutarties duomenys</summary>
        <dl className="sutarties-duomenys">
          {p.details.map((x) => (
            <Fragment key={x.etikete}>
              <dt>{x.etikete}</dt>
              <dd>{x.reiksme}</dd>
            </Fragment>
          ))}
        </dl>
      </details>
    </article>
  )
}

function VerciuIstorija({ produktas: p, onChanged }: { produktas: PensijuProduktas; onChanged: () => Promise<unknown> }) {
  const [klaida, setKlaida] = useState<string | null>(null)
  if (p.valuations.length === 0) return null

  async function istrinti(id: number, data: string) {
    if (!confirm(`Ištrinti ${data} įvestą vertę?`)) return
    try {
      await api.deletePensionValue(id)
      await onChanged()
    } catch (err) {
      setKlaida(err instanceof Error ? err.message : 'Nepavyko ištrinti.')
    }
  }

  const saltiniai = { rankinis: 'įvesta', excel: 'Excel', ataskaita: 'ataskaita' } as const
  return (
    <details className="kreditas-skyrius">
      <summary>
        Įvestos vertės
        <span>paskutinė {p.valuations[0].date}</span>
      </summary>
      {klaida && <p className="error">{klaida}</p>}
      <table className="kredito-lentele">
        <tbody>
          {p.valuations.map((v) => (
            <tr key={v.id}>
              <td className="nowrap">
                {v.date} <small className="saltinis">{saltiniai[v.source]}</small>
              </td>
              <td className="num">{eur(v.valueCents)}</td>
              <td className="tight">
                {v.source === 'rankinis' && (
                  <button className="ghost small" onClick={() => istrinti(v.id, v.date)}>
                    ištrinti
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}

type GpmEilute = {
  moketojas: string
  sumoketaCents: number
  /** Tinkamos įmokos per metus: sumokėta + likusių mėnesių planas. */
  metuCents: number
  graza: number
  dalys: { pavadinimas: string; cents: number }[]
}

function gpmDaliesPavadinimas(p: PensijuProduktas) {
  if (p.pillar === 'PZU') return `PZU gyvybės draudimas – ${p.owner}`
  const dalis = p.gpm?.portfolio ? ` (tik ${p.gpm.portfolio.toLowerCase()} įmoka)` : ''
  return `${p.owner} · ${PAKOPA[p.pillar]}${dalis}`
}

/** III pakopos ir gyvybės draudimo įmokos sudedamos kiekvienam mokėtojui — riba bendra. */
function gpmPagalMoketoja(d: PensijuDuomenys): GpmEilute[] {
  const pagal = new Map<string, GpmEilute>()
  for (const p of d.products) {
    if (!p.gpm) continue
    const e = pagal.get(p.gpm.payer) ?? { moketojas: p.gpm.payer, sumoketaCents: 0, metuCents: 0, graza: 0, dalys: [] }
    e.sumoketaCents += p.gpm.paidCents
    e.metuCents += p.gpm.projectedCents
    e.dalys.push({ pavadinimas: gpmDaliesPavadinimas(p), cents: p.gpm.projectedCents })
    pagal.set(p.gpm.payer, e)
  }
  const tvarka = d.people.map((z) => z.owner)
  const vieta = (moketojas: string) => (tvarka.includes(moketojas) ? tvarka.indexOf(moketojas) : tvarka.length)
  return [...pagal.values()]
    .map((e) => ({ ...e, graza: Math.round(Math.min(e.metuCents, d.gpm.limitCents) * d.gpm.rate) }))
    .sort((a, b) => vieta(a.moketojas) - vieta(b.moketojas))
}

function GpmKortele({ duomenys: d, eilutes }: { duomenys: PensijuDuomenys; eilutes: GpmEilute[] }) {
  if (eilutes.length === 0) return null
  return (
    <section className="kreditas">
      <header className="kreditas-virsus">
        <div>
          <h3>GPM susigrąžinimas už {d.gpm.year} m.</h3>
          <span className="kreditas-sub">
            {procentai(d.gpm.rate, 0)} nuo savo lėšomis mokamų III pakopos ir gyvybės draudimo įmokų, ne daugiau kaip
            nuo {eur(d.gpm.limitCents)} per metus vienam žmogui · deklaruoti iki {d.gpm.deadline}
          </span>
        </div>
      </header>

      {eilutes.map((e) => {
        const panaudota = Math.min(1, e.metuCents / d.gpm.limitCents)
        const skirtumas = d.gpm.limitCents - e.metuCents
        return (
          <div key={e.moketojas} className="gpm-eilute">
            <div className="kreditas-likutis">
              <div>
                <span>{e.moketojas} atgaus</span>
                <strong>~{eur(e.graza)}</strong>
              </div>
              <div className="desine">
                <span>Tinkamos įmokos per metus</span>
                <strong>~{eur(e.metuCents)}</strong>
              </div>
            </div>
            <div
              className="kreditas-progresas"
              role="progressbar"
              aria-label={`${e.moketojas}: išnaudota GPM lengvatos riba`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(panaudota * 100)}
            >
              <div style={{ width: `${panaudota * 100}%` }} />
            </div>
            <p className="kreditas-po">
              Jau sumokėta {eur(e.sumoketaCents)}, iki metų pabaigos pagal planą ~{eur(e.metuCents)} ·{' '}
              {skirtumas > 0
                ? `iki ribos liko ${eur(skirtumas)} (dar ${eur(Math.round(skirtumas * d.gpm.rate))} galimos grąžos)`
                : skirtumas === 0
                  ? 'riba išnaudota'
                  : `riba viršyta ${eur(-skirtumas)} — nuo šios dalies grąžos nebėra`}
            </p>
            <ul className="gpm-dalys">
              {e.dalys.map((x) => (
                <li key={x.pavadinimas}>
                  <span>{x.pavadinimas}</span>
                  <span className="num">~{eur(x.cents)}</span>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
      <p className="paaiskinimas">
        Skaičiuojama pagal šių metų įmokas (ataskaitos, bankas, Excel istorija) ir likusių mėnesių planą. Įmokos,
        kurias moka darbdavys, neįskaičiuojamos. Galutinė suma priklauso nuo metinės pajamų deklaracijos.
      </p>
    </section>
  )
}

const SCENARIJAI = [0.03, 0.05, 0.07]
const INFLIACIJA = 0.02

function Prognoze({ duomenys: d }: { duomenys: PensijuDuomenys }) {
  const [graza, setGraza] = useState(0.05)
  const zmones = d.people.filter((z) => z.valueCents > 0)
  if (zmones.length === 0) return null

  return (
    <section className="kreditas">
      <header className="kreditas-virsus">
        <div>
          <h3>Prognozė iki pensijos</h3>
          <span className="kreditas-sub">
            II ir III pakopa, jei įmokos liktų dabartinės, o metinė grąža — pasirinkta
          </span>
        </div>
      </header>

      <label className="prognozes-slankiklis">
        <span>
          Metinė grąža <strong>{procentai(graza)}</strong>
        </span>
        <input
          type="range"
          min={0}
          max={0.1}
          step={0.005}
          value={graza}
          onChange={(e) => setGraza(Number(e.target.value))}
        />
      </label>

      <div className="prognozes-zmones">
        {zmones.map((z) => {
          const verte = ateitiesVerte(z.valueCents, z.monthlyContributionCents, z.monthsToPayout, graza)
          const imokos = z.monthlyContributionCents * z.monthsToPayout
          const siandienos = Math.round(verte / Math.pow(1 + INFLIACIJA, z.monthsToPayout / 12))
          return (
            <div key={z.owner} className="rodiklis">
              <span className="rodiklis-etikete">
                {z.owner} · {z.payoutDate.slice(0, 4)} m.
              </span>
              <strong className="rodiklis-reiksme">~{eur(verte)}</strong>
              <span className="rodiklis-pastaba">
                dabar {eur(z.valueCents)} + įmokos {eur(imokos)} + grąža {eur(Math.max(0, verte - z.valueCents - imokos))}
              </span>
              <span className="rodiklis-pastaba">šiandienos pinigais ~{eur(siandienos)}</span>
            </div>
          )
        })}
      </div>

      <details className="kreditas-skyrius">
        <summary>
          Scenarijai
          <span>3, 5 ir 7 % metinė grąža</span>
        </summary>
        <div className="table-wrap">
          <table className="kredito-lentele">
            <thead>
              <tr>
                <th>Kas</th>
                {SCENARIJAI.map((s) => (
                  <th key={s} className="num">
                    {procentai(s, 0)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {zmones.map((z) => (
                <tr key={z.owner}>
                  <td>
                    {z.owner} <small className="po-tekstu">{z.payoutDate}</small>
                  </td>
                  {SCENARIJAI.map((s) => (
                    <td key={s} className="num">
                      {eur(ateitiesVerte(z.valueCents, z.monthlyContributionCents, z.monthsToPayout, s))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <p className="paaiskinimas">
        Tai tik apytikslis skaičiavimas, ne patarimas: sumos nominalios, „šiandienos pinigais" — atmetus{' '}
        {procentai(INFLIACIJA, 0)} metinę infliaciją. II pakopos įmokos keisis kartu su atlyginimu, fondų grąža
        kasmet svyruoja.
      </p>
    </section>
  )
}

/** Trumpa kaupimo santrauka kitoms grupėms (pvz. „Draudimas" — PZU sukaupta suma). */
export function PensijuSantrauka({ produktai }: { produktai: PensijuProduktas[] }) {
  const viso = produktai.reduce((s, p) => s + (p.valueCents ?? 0), 0)
  return (
    <section className="kreditas pensiju-santrauka">
      <header className="kreditas-virsus">
        <div>
          <h3>Sukaupta investicinėje dalyje</h3>
          <span className="kreditas-sub">iš „Pensijos“ skilties · iš viso {eur(viso)}</span>
        </div>
      </header>
      <div className="table-wrap">
        <table className="kredito-lentele">
          <thead>
            <tr>
              <th>Sutartis</th>
              <th className="num">Sukaupta</th>
              <th className="num">Įmoka / mėn.</th>
              <th className="num">Galioja iki</th>
            </tr>
          </thead>
          <tbody>
            {produktai.map((p) => (
              <tr key={p.code}>
                <td>{pavadinimas(p)}</td>
                <td className="num">
                  {p.valueCents === null ? '—' : eur(p.valueCents)}
                  {p.valueDate && (
                    <small className="po-tekstu">
                      {p.valueDate}
                      {p.valueEstimated ? ', apytiksliai' : ''}
                    </small>
                  )}
                </td>
                <td className="num">{p.monthlyContributionCents ? eur(p.monthlyContributionCents) : '—'}</td>
                <td className="num nowrap">{p.endDate ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="paaiskinimas">Vertes atnaujinti ir GPM grąžą matyti galima skiltyje „Pensijos“.</p>
    </section>
  )
}

function PzuKortele({
  produktai,
  onChanged,
  onIvesti,
}: {
  produktai: PensijuProduktas[]
  onChanged: () => Promise<unknown>
  onIvesti: () => void
}) {
  const viso = produktai.reduce((s, p) => s + (p.valueCents ?? 0), 0)
  return (
    <section className="kreditas">
      <header className="kreditas-virsus">
        <div>
          <h3>PZU gyvybės draudimai</h3>
          <span className="kreditas-sub">sukaupta investicinė dalis · iš viso {eur(viso)}</span>
        </div>
        <button className="ghost small" onClick={onIvesti}>
          Įvesti vertes
        </button>
      </header>
      <div className="table-wrap">
        <table className="kredito-lentele">
          <thead>
            <tr>
              <th>Apdraustasis</th>
              <th className="num">Sukaupta</th>
              <th className="num">Įmoka / mėn.</th>
              <th className="num">Sutartis iki</th>
            </tr>
          </thead>
          <tbody>
            {produktai.map((p) => (
              <tr key={p.code}>
                <td>{p.owner}</td>
                <td className="num">
                  {p.valueCents === null ? '—' : eur(p.valueCents)}
                  {p.valueDate && <small className="po-tekstu">{p.valueDate}</small>}
                </td>
                <td className="num">{p.monthlyContributionCents ? eur(p.monthlyContributionCents) : '—'}</td>
                <td className="num nowrap">{p.endDate ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {produktai.map((p) => (
        <VerciuIstorija key={p.code} produktas={{ ...p, details: [] }} onChanged={onChanged} />
      ))}
      <p className="paaiskinimas">
        Sukauptą sumą rasi PZU savitarnoje arba metinėje ataskaitoje — užtenka įvesti kartą per metus.
      </p>
    </section>
  )
}

function AtnaujinimoDialogas({
  duomenys: d,
  onClose,
  onSaved,
}: {
  duomenys: PensijuDuomenys
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const rankiniai = d.products.filter((p) => p.valuation === 'rankinis')
  const vienetiniai = d.products.filter((p) => p.valuation === 'vienetai' && p.holdings.length > 0)
  const [data, setData] = useState(d.today)
  const [vertes, setVertes] = useState<Record<string, string>>({})
  const [vienetai, setVienetai] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    const veiksmai: (() => Promise<unknown>)[] = []
    for (const p of rankiniai) {
      const c = centai(vertes[p.code] ?? '')
      if (c === null) continue
      if (Number.isNaN(c)) return setError(`${pavadinimas(p)}: neteisinga suma.`)
      veiksmai.push(() => api.addPensionValue(p.code, { date: data, valueCents: c }))
    }
    for (const p of vienetiniai) {
      for (const h of p.holdings) {
        const tekstas = (vienetai[`${p.code}|${h.portfolio}|${h.isin}`] ?? '').replace(/\s/g, '').replace(',', '.')
        if (!tekstas) continue
        const u = Number(tekstas)
        if (!Number.isFinite(u) || u <= 0) return setError(`${pavadinimas(p)}, ${h.fundName}: neteisingas vienetų skaičius.`)
        veiksmai.push(() =>
          api.setPensionUnits(p.code, { portfolio: h.portfolio, isin: h.isin, units: u, unitsDate: data })
        )
      }
    }
    if (veiksmai.length === 0) return setError('Įrašyk bent vieną sumą arba vienetų skaičių.')

    setSaving(true)
    setError(null)
    try {
      for (const veiksmas of veiksmai) await veiksmas()
      await onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nepavyko išsaugoti.')
      setSaving(false)
    }
  }

  return createPortal(
    <div className="modal-fonas" onClick={onClose}>
      <div className="modal pensiju-dialogas" onClick={(e) => e.stopPropagation()}>
        <h3>Atnaujinti pensijų vertes</h3>
        <p className="paaiskinimas">
          SEB ir Swedbank fondų kainos atsinaujina pačios. Čia įvesk tai, ko automatiškai gauti negalima — sukauptą
          sumą iš savitarnos. Tuščius laukus praleisk.
        </p>

        <label>
          Data
          <input type="date" value={data} max={d.today} onChange={(e) => setData(e.target.value)} />
        </label>

        <h4>Sukaupta suma</h4>
        {rankiniai.map((p) => (
          <label key={p.code} className="pensiju-laukas">
            <span>
              {pavadinimas(p)}
              <small>
                dabar {p.valueCents === null ? '—' : eur(p.valueCents)}
                {p.valueDate ? ` (${p.valueDate}${p.valueEstimated ? ', apytiksliai' : ''})` : ''}
              </small>
            </span>
            <input
              inputMode="decimal"
              placeholder="pvz. 7 105,52"
              value={vertes[p.code] ?? ''}
              onChange={(e) => setVertes({ ...vertes, [p.code]: e.target.value })}
            />
          </label>
        ))}

        <details className="kreditas-skyrius">
          <summary>
            Patikslinti fondų vienetus
            <span>nebūtina, pvz. kartą per ketvirtį</span>
          </summary>
          {vienetiniai.flatMap((p) =>
            p.holdings.map((h) => {
              const raktas = `${p.code}|${h.portfolio}|${h.isin}`
              return (
                <label key={raktas} className="pensiju-laukas">
                  <span>
                    {pavadinimas(p)} · {h.fundName}
                    {h.portfolio ? ` (${h.portfolio})` : ''}
                    <small>
                      dabar {h.units.toLocaleString('lt-LT', { maximumFractionDigits: 4 })} vnt.
                      {h.estimated ? ', apytiksliai' : ''}
                    </small>
                  </span>
                  <input
                    inputMode="decimal"
                    placeholder="vienetai"
                    value={vienetai[raktas] ?? ''}
                    onChange={(e) => setVienetai({ ...vienetai, [raktas]: e.target.value })}
                  />
                </label>
              )
            })
          )}
        </details>

        {error && <p className="error">{error}</p>}

        <div className="modal-mygtukai">
          <button className="ghost" onClick={onClose}>
            Atšaukti
          </button>
          <button onClick={save} disabled={saving}>
            {saving ? 'Saugoma...' : 'Išsaugoti'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
