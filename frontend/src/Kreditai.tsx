import { Fragment, useState } from 'react'
import { eur, type Kreditas } from './api'
import LikucioGrafikas from './LikucioGrafikas'

type Props = { kreditai: Kreditas[] }

type Formos = [string, string, string]
const IMOKOS: Formos = ['įmoka', 'įmokos', 'įmokų']
const KREDITAI: Formos = ['kreditas', 'kreditai', 'kreditų']
const NURASYMAI: Formos = ['nurašymas', 'nurašymai', 'nurašymų']

/** 1 įmoka, 2 įmokos, 10 įmokų, 21 įmoka. */
function kiekis(n: number, [vienas, keli, daug]: Formos) {
  const d = n % 10
  const s = n % 100
  if (d === 1 && s !== 11) return `${n} ${vienas}`
  if (d >= 2 && !(s >= 12 && s <= 19)) return `${n} ${keli}`
  return `${n} ${daug}`
}

const procentai = (x: number) => `${x.toLocaleString('lt-LT', { maximumFractionDigits: 3 })} %`

const punktai = (x: number) =>
  `${x > 0 ? '+' : '−'}${Math.abs(x).toLocaleString('lt-LT', { maximumFractionDigits: 2 })} p. p.`

function trukme(menesiai: number) {
  const metai = Math.floor(menesiai / 12)
  const men = menesiai % 12
  return [metai ? `${metai} m.` : '', men ? `${men} mėn.` : ''].filter(Boolean).join(' ') || 'mažiau nei mėnuo'
}

function kada(data: string, siandien: string) {
  const dienos = Math.round((Date.parse(data) - Date.parse(siandien)) / 86_400_000)
  if (dienos <= 0) return 'šiandien'
  if (dienos < 60) return `po ${dienos} d.`
  return `po ${trukme(Math.round(dienos / 30.44))}`
}

const sumuoti = (kreditai: Kreditas[], f: (k: Kreditas) => number) =>
  kreditai.reduce((s, k) => s + f(k), 0)

/**
 * Kreditų skilties viršus: bendra įsipareigojimų suvestinė, artėjantys svarbūs
 * įvykiai ir po kortelę kiekvienam kreditui.
 */
export default function Kreditai({ kreditai }: Props) {
  const siandien = new Date().toLocaleDateString('sv-SE')
  const ivykiai = kreditai
    .flatMap((k) => k.events)
    .filter((e) => e.date >= siandien)
    .sort((a, b) => a.date.localeCompare(b.date))

  return (
    <div className="kreditai">
      <div className="kreditu-suvestine">
        <Rodiklis
          etikete="Visa skola"
          reiksme={eur(sumuoti(kreditai, (k) => k.balanceCents))}
          pastaba={kiekis(kreditai.length, KREDITAI)}
        />
        <Rodiklis
          etikete="Įmokos per mėnesį"
          reiksme={eur(sumuoti(kreditai, (k) => k.monthlyPaymentCents))}
          pastaba={`iš jų palūkanoms ~${eur(sumuoti(kreditai, (k) => k.nextPayment?.interest_cents ?? 0))}`}
        />
        <Rodiklis
          etikete="Liko sumokėti palūkanų"
          reiksme={eur(sumuoti(kreditai, (k) => k.remaining.interestCents))}
          pastaba="pagal dabartinius grafikus"
        />
        <Rodiklis
          etikete="Iš viso dar mokėti"
          reiksme={eur(sumuoti(kreditai, (k) => k.remaining.totalCents))}
          pastaba="kreditas ir palūkanos"
        />
      </div>

      {ivykiai.length > 0 && (
        <section className="kreditu-ivykiai">
          <h3>Artėja</h3>
          <ul>
            {ivykiai.map((e) => (
              <li key={`${e.date}-${e.title}`}>
                <span className="ivykio-data">{e.date}</span>
                <span className="ivykio-pavadinimas">
                  {e.title}
                  {e.amountCents !== null && <strong> · {eur(e.amountCents)}</strong>}
                </span>
                <span className="ivykio-kada">{kada(e.date, siandien)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {kreditai.map((k) => (
        <KreditoKortele key={k.id} kreditas={k} siandien={siandien} />
      ))}
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

function KreditoKortele({ kreditas: k, siandien }: { kreditas: Kreditas; siandien: string }) {
  const kita = k.nextPayment
  const likucioSaltinis =
    k.anchor.paymentsAfter === 0
      ? `likutis pagal banko duomenis ${k.anchor.date}`
      : `banko likutis ${k.anchor.date} minus ${kiekis(k.anchor.paymentsAfter, NURASYMAI)} po jo (${eur(k.anchor.principalAfterCents)} kreditui)`

  return (
    <article className="kreditas">
      <header className="kreditas-virsus">
        <div>
          <h3>{k.name}</h3>
          <span className="kreditas-sub">
            {[k.asset, k.lender, k.contractNo && `sutartis ${k.contractNo}`].filter(Boolean).join(' · ')}
          </span>
        </div>
        <span className="tag">
          {k.rateType === 'kintama' ? 'kintamos' : 'fiksuotos'} palūkanos {procentai(k.ratePct)}
        </span>
      </header>

      <div className="kreditas-likutis">
        <div>
          <span>Likutis</span>
          <strong>{eur(k.balanceCents)}</strong>
        </div>
        <div className="desine">
          <span>Grąžinta</span>
          <strong>{eur(k.paidCents)}</strong>
        </div>
      </div>
      <div
        className="kreditas-progresas"
        role="progressbar"
        aria-label="Grąžinta kredito dalis"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(k.progress * 100)}
      >
        <div style={{ width: `${Math.min(100, Math.max(0, k.progress * 100))}%` }} />
      </div>
      <p className="kreditas-po">
        Grąžinta {Math.round(k.progress * 100)} % iš {eur(k.originalCents)} · {likucioSaltinis}
      </p>

      <dl className="kreditas-faktai">
        <Faktas
          pavadinimas="Mėnesio įmoka"
          reiksme={eur(k.monthlyPaymentCents)}
          pastaba={k.rateType === 'kintama' ? 'keisis kartu su palūkanomis' : 'pastovi'}
        />
        {kita && (
          <Faktas
            pavadinimas="Kita įmoka pagal grafiką"
            reiksme={`${kita.due_date} · ${eur(kita.payment_cents)}`}
            pastaba={`kreditui ${eur(kita.principal_cents)} · palūkanoms ${eur(kita.interest_cents)}`}
          />
        )}
        <Faktas
          pavadinimas="Palūkanų norma"
          reiksme={procentai(k.ratePct)}
          pastaba={
            k.rateType === 'kintama' && k.baseRatePct !== null
              ? `${k.baseRateName} ${procentai(k.baseRatePct)} + marža ${procentai(k.marginPct ?? 0)}`
              : 'fiksuotos'
          }
        />
        <Faktas
          pavadinimas="Pabaiga"
          reiksme={k.endDate}
          pastaba={`liko ${trukme(k.remaining.monthsLeft)} · ${kiekis(k.remaining.count, IMOKOS)}`}
        />
        <Faktas
          pavadinimas="Liko sumokėti palūkanų"
          reiksme={eur(k.remaining.interestCents)}
          pastaba={`iš viso dar mokėti ${eur(k.remaining.totalCents)}`}
        />
        {k.interestPaid.since && (
          <Faktas
            pavadinimas="Jau sumokėta palūkanų"
            reiksme={eur(k.interestPaid.cents)}
            pastaba={`nuo ${k.interestPaid.since}${k.historySource === 'grafikas' ? ', pagal grafiką' : ', pagal išrašus ir Excel'}`}
          />
        )}
      </dl>

      {k.residualCents !== null && k.lastPayment && (
        <div className="kreditas-pastaba">
          <strong>
            {k.lastPayment.due_date} laukia paskutinė įmoka – {eur(k.lastPayment.payment_cents)}
          </strong>
          <span>
            Į ją įeina likutinė vertė {eur(k.residualCents)}.
            {k.residualSavingCents !== null &&
              ` Kad ją sumokėtum be refinansavimo, reikėtų atsidėti apie ${eur(k.residualSavingCents)} per mėnesį (liko ${kiekis(k.remaining.count, IMOKOS)}).`}
          </span>
        </div>
      )}

      {k.sensitivity && (
        <div className="kreditas-jautrumas">
          <span>
            {k.nextRateChange ? `${k.nextRateChange} palūkanos bus perskaičiuotos. ` : ''}
            Jei {k.baseRateName ?? 'bazinė norma'} pasikeistų, įmoka būtų apie:
          </span>
          <div className="jautrumo-variantai">
            {k.sensitivity.variants.map((v) => {
              const skirtumas = v.paymentCents - k.sensitivity!.basePaymentCents
              return (
                <div key={v.deltaPct} className="jautrumo-variantas">
                  <small>{punktai(v.deltaPct)}</small>
                  <strong>{eur(v.paymentCents)}</strong>
                  <small>
                    {skirtumas >= 0 ? '+' : '−'}
                    {eur(Math.abs(skirtumas))} per mėn.
                  </small>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="kreditas-grafikas">
        <div className="grafiko-antraste">
          <h4>Likutis pagal grafiką</h4>
          <span>ištisinė linija – praėję mokėjimai, punktyrinė – planas</span>
        </div>
        <LikucioGrafikas taskai={k.chart} siandien={siandien} dabartinisLikutis={k.balanceCents} />
      </div>

      <GrafikoLentele kreditas={k} />
      <SumoketaPagalMetus kreditas={k} />

      <details className="kreditas-skyrius">
        <summary>Sutarties duomenys</summary>
        <dl className="sutarties-duomenys">
          {k.details.map((d) => (
            <Fragment key={d.etikete}>
              <dt>{d.etikete}</dt>
              <dd>{d.reiksme}</dd>
            </Fragment>
          ))}
        </dl>
      </details>
    </article>
  )
}

const RODYTI_PRADZIOJE = 12

function GrafikoLentele({ kreditas: k }: { kreditas: Kreditas }) {
  const [visos, setVisos] = useState(false)
  const likusios = k.schedule.filter((r) => !r.paid)
  const sumoketos = k.schedule.length - likusios.length
  const rodomos = visos ? likusios : likusios.slice(0, RODYTI_PRADZIOJE)

  return (
    <details className="kreditas-skyrius">
      <summary>
        Mokėjimų grafikas
        <span>
          liko {kiekis(likusios.length, IMOKOS)}
          {sumoketos > 0 && `, sumokėta ${sumoketos}`}
        </span>
      </summary>
      <div className="table-wrap">
        <table className="kredito-lentele">
          <thead>
            <tr>
              <th>Data</th>
              <th className="num">Kreditui</th>
              <th className="num">Palūkanoms</th>
              <th className="num">Įmoka</th>
              <th className="num">Likutis po</th>
            </tr>
          </thead>
          <tbody>
            {rodomos.map((r, i) => (
              <tr key={r.seq} className={i === 0 ? 'artimiausia' : undefined}>
                <td className="nowrap">{r.due_date}</td>
                <td className="num">{eur(r.principal_cents)}</td>
                <td className="num">{eur(r.interest_cents)}</td>
                <td className="num">{eur(r.payment_cents)}</td>
                <td className="num">{eur(r.balance_after_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {likusios.length > RODYTI_PRADZIOJE && (
        <button className="ghost small" onClick={() => setVisos(!visos)}>
          {visos ? 'Rodyti tik artimiausias' : `Rodyti visas (${likusios.length})`}
        </button>
      )}
    </details>
  )
}

function SumoketaPagalMetus({ kreditas: k }: { kreditas: Kreditas }) {
  const [atidaryti, setAtidaryti] = useState<Set<string>>(new Set())
  if (k.history.length === 0) return null

  function perjungti(metai: string) {
    setAtidaryti((prev) => {
      const next = new Set(prev)
      if (next.has(metai)) next.delete(metai)
      else next.add(metai)
      return next
    })
  }

  return (
    <details className="kreditas-skyrius">
      <summary>
        Sumokėta pagal metus
        <span>{k.historySource === 'israsai' ? 'pagal išrašus ir Excel istoriją' : 'pagal lizingo grafiką'}</span>
      </summary>
      {k.historySource === 'grafikas' && (
        <p className="paaiskinimas">
          Bankas nurašo bendrą įmoką, todėl dalys kreditui ir palūkanoms imamos iš grafiko.
        </p>
      )}
      <div className="table-wrap">
        <table className="kredito-lentele">
          <thead>
            <tr>
              <th>Laikotarpis</th>
              <th className="num">Kreditui</th>
              <th className="num">Palūkanoms</th>
              <th className="num">Iš viso</th>
            </tr>
          </thead>
          <tbody>
            {k.history.map((metai) => (
              <Fragment key={metai.year}>
                <tr className="metu-eilute">
                  <td>
                    <button className="linkish" onClick={() => perjungti(metai.year)} aria-expanded={atidaryti.has(metai.year)}>
                      <span className={atidaryti.has(metai.year) ? 'rodykle atidaryta' : 'rodykle'}>▶</span>{' '}
                      {metai.year}
                    </button>
                  </td>
                  <td className="num">{eur(metai.principal)}</td>
                  <td className="num">{eur(metai.interest)}</td>
                  <td className="num">{eur(metai.total)}</td>
                </tr>
                {atidaryti.has(metai.year) &&
                  metai.months.map((m) => (
                    <tr key={m.month} className="menesio-eilute">
                      <td>{m.month}</td>
                      <td className="num">{eur(m.principal)}</td>
                      <td className="num">{eur(m.interest)}</td>
                      <td className="num">{eur(m.total)}</td>
                    </tr>
                  ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
