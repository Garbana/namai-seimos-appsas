import type { ReactNode } from 'react'
import {
  eur,
  type Draudimai as DraudimuDuomenys,
  type DraudimoPolisas,
  type Pensijos as PensijuDuomenys,
} from './api'

type Props = {
  duomenys: DraudimuDuomenys
  /** Rodomi polisai — grupės ekrane tik tie, kurių įmokos patenka į tos grupės kategorijas. */
  polisai: DraudimoPolisas[]
  pensijos: PensijuDuomenys | null
}

const procentai = (x: number) => `${x.toLocaleString('lt-LT', { maximumFractionDigits: 2 })} %`
const suma = (xs: number[]) => xs.reduce((s, x) => s + x, 0)

function kada(data: string, siandien: string) {
  const dienos = Math.round((Date.parse(data) - Date.parse(siandien)) / 86_400_000)
  if (dienos < 0) return 'praėjo'
  if (dienos === 0) return 'šiandien'
  if (dienos < 60) return `po ${dienos} d.`
  const menesiai = Math.round(dienos / 30.44)
  if (menesiai < 24) return `po ${menesiai} mėn.`
  return `po ${Math.round(menesiai / 12)} m.`
}

function Rodiklis({ etikete, reiksme, pastaba }: { etikete: string; reiksme: string; pastaba?: ReactNode }) {
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

/** Naujausia investicinės dalies vertė: pensijų skilties įvesta arba savitarnos. */
function investicineVerte(p: DraudimoPolisas, pensijos: PensijuDuomenys | null) {
  if (!p.investment) return null
  const s = p.investment.savitarna
  const produktas = pensijos?.products.find((x) => x.code === p.pensionProductCode)
  if (produktas?.valueCents != null && produktas.valueDate && produktas.valueDate > s.data) {
    return { cents: produktas.valueCents, date: produktas.valueDate, isSavitarnos: false }
  }
  return { cents: s.kapitalas_cents, date: s.data, isSavitarnos: true }
}

/**
 * Draudimų skiltis: visos sutartys ir įmokos vienoje vietoje, artėjantys
 * pakeitimai, kiekvieno poliso draudimo sumos, sąlygos ir PZU investicinė dalis.
 */
export default function Draudimai({ duomenys: d, polisai, pensijos }: Props) {
  const siandien = d.today
  const galiojantys = polisai.filter((p) => p.status === 'galioja')
  const menesiui = suma(galiojantys.map((p) => p.monthlyEquivalentCents))
  const metams = suma(galiojantys.map((p) => p.premiumCents))
  const poPakeitimu = suma(galiojantys.map((p) => p.upcoming?.monthlyEquivalentCents ?? p.monthlyEquivalentCents))
  const pakeitimoData = galiojantys
    .map((p) => p.upcoming?.periodStart)
    .filter((x): x is string => !!x)
    .sort()[0]
  const numeriai = new Set(polisai.map((p) => p.policyNo))
  const ivykiai = d.events.filter((e) => numeriai.has(e.policyNo) && e.date >= siandien).slice(0, 8)
  const sukaupta = suma(polisai.map((p) => investicineVerte(p, pensijos)?.cents ?? 0))
  const grupes = [...new Set(polisai.map((p) => p.objectGroup))]

  return (
    <div className="kreditai draudimai">
      <div className="kreditu-suvestine">
        <Rodiklis
          etikete="Draudimo įmokos per mėnesį"
          reiksme={eur(menesiui)}
          pastaba={
            pakeitimoData && poPakeitimu !== menesiui
              ? `nuo ${pakeitimoData} — ${eur(poPakeitimu)}`
              : `${galiojantys.length} galiojančios sutartys`
          }
        />
        <Rodiklis etikete="Per metus" reiksme={eur(metams)} pastaba="su vienkartinėmis įmokomis ir saugumo įnašu" />
        {sukaupta > 0 && (
          <Rodiklis etikete="Sukaupta investicinėje dalyje" reiksme={eur(sukaupta)} pastaba="PZU gyvybės draudimai" />
        )}
        {ivykiai[0] && (
          <Rodiklis
            etikete={`Artimiausia · ${kada(ivykiai[0].date, siandien)}`}
            reiksme={ivykiai[0].date}
            pastaba={ivykiai[0].title}
          />
        )}
      </div>

      {ivykiai.length > 0 && (
        <section className="kreditu-ivykiai">
          <h3>Artėja</h3>
          <ul>
            {ivykiai.map((e) => (
              <li key={`${e.date}-${e.policyNo}-${e.title}`}>
                <span className="ivykio-data">{e.date}</span>
                <span className="ivykio-pavadinimas">
                  {e.title}
                  {e.amountCents !== null && (
                    <strong>
                      {' '}
                      · {eur(e.amountCents)}
                      {e.note ? ` ${e.note}` : ''}
                    </strong>
                  )}
                </span>
                <span className="ivykio-kada">{kada(e.date, siandien)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ImokuLentele polisai={polisai} />

      {grupes.map((grupe) => {
        const savi = polisai.filter((p) => p.objectGroup === grupe)
        const aktyvus = savi.filter((p) => p.status === 'galioja')
        return (
          <section key={grupe} className="draudimu-grupe">
            <header>
              <h3>{grupe}</h3>
              <span>
                {eur(suma(aktyvus.map((p) => p.monthlyEquivalentCents)))} / mėn. ·{' '}
                {eur(suma(aktyvus.map((p) => p.premiumCents)))} / metus
              </span>
            </header>
            {savi.map((p) => (
              <PolisoKortele key={p.policyNo} p={p} pensijos={pensijos} siandien={siandien} />
            ))}
          </section>
        )
      })}
    </div>
  )
}

function ImokuLentele({ polisai }: { polisai: DraudimoPolisas[] }) {
  const galiojantys = polisai.filter((p) => p.status === 'galioja')
  return (
    <section className="kreditas">
      <div className="grafiko-antraste">
        <h4>Visos įmokos vienoje vietoje</h4>
        <span>metinės sutartys perskaičiuotos į mėnesį</span>
      </div>
      <div className="table-wrap">
        <table className="kredito-lentele imoku-lentele">
          <thead>
            <tr>
              <th>Sutartis</th>
              <th>Draudikas</th>
              <th className="num">Per mėn.</th>
              <th className="num">Per metus</th>
              <th className="num">Galioja iki</th>
              <th className="num">Paskutinis nurašymas</th>
            </tr>
          </thead>
          <tbody>
            {galiojantys.map((p) => (
              <tr key={p.policyNo}>
                <td>
                  {p.objectGroup} · {p.kindLabel}
                  <small>{p.policyNo}</small>
                </td>
                <td>{p.insurer}</td>
                <td className="num">
                  {eur(p.monthlyEquivalentCents)}
                  {!p.monthlyCents && <small>mokama kartą per metus</small>}
                </td>
                <td className="num">{eur(p.premiumCents)}</td>
                <td className="num nowrap">
                  {p.contractEnd ?? p.periodEnd}
                  {p.upcoming && <small>nuo {p.upcoming.periodStart} brangsta</small>}
                </td>
                <td className="num nowrap">
                  {p.lastPayment ? eur(p.lastPayment.cents) : '—'}
                  {p.lastPayment && <small>{p.lastPayment.date}</small>}
                </td>
              </tr>
            ))}
            <tr className="suma">
              <td>Iš viso</td>
              <td />
              <td className="num">{eur(suma(galiojantys.map((p) => p.monthlyEquivalentCents)))}</td>
              <td className="num">{eur(suma(galiojantys.map((p) => p.premiumCents)))}</td>
              <td />
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}

function PolisoKortele({
  p,
  pensijos,
  siandien,
}: {
  p: DraudimoPolisas
  pensijos: PensijuDuomenys | null
  siandien: string
}) {
  const verte = investicineVerte(p, pensijos)
  // Būsimo laikotarpio pastabos dažniausiai kartoja dabartines — rodomos, tik jei dabartinių nėra.
  const pastabos = p.notes.length > 0 ? p.notes : (p.upcoming?.notes ?? [])
  // Jei banko išraše nurašymo nėra (pvz. mokėta dar iki išrašų — tas mėnuo tik Excel istorijoje),
  // rodoma paskutinė jau praėjusi grafiko įmoka.
  const praejusiGrafiko = [...p.schedule].reverse().find((s) => s.data <= siandien)
  const suIsskaita = p.coverages.some((c) => c.isskaita)

  return (
    <article className="kreditas polisas">
      <header className="kreditas-virsus">
        <div>
          <h3>{p.title}</h3>
          <span className="kreditas-sub">
            {[p.insurer, `poliso Nr. ${p.policyNo}`, p.kind !== 'gyvybes' ? p.insured : null].filter(Boolean).join(' · ')}
          </span>
        </div>
        <span className={`tag ${p.status}`}>
          {p.status === 'galioja'
            ? `galioja iki ${p.periodEnd}`
            : p.status === 'busima'
              ? `įsigalios ${p.periodStart}`
              : `baigėsi ${p.periodEnd}`}
        </span>
      </header>

      <div className="kreditas-likutis">
        <div>
          <span>{p.monthlyCents ? 'Įmoka per mėnesį' : 'Įmoka už metus'}</span>
          <strong>{eur(p.monthlyCents ?? p.premiumCents)}</strong>
        </div>
        <div className="desine">
          <span>{p.contractEnd ? 'Sutartis galioja iki' : 'Laikotarpis baigiasi'}</span>
          <strong>{p.contractEnd ?? p.periodEnd}</strong>
        </div>
      </div>

      <dl className="kreditas-faktai">
        <Faktas
          pavadinimas="Per metus"
          reiksme={eur(p.premiumCents)}
          pastaba={
            p.securityLevyCents
              ? `iš jų saugumo įnašas ${eur(p.securityLevyCents)}`
              : p.contractStart
                ? `sutartis nuo ${p.contractStart}`
                : `${p.periodStart} – ${p.periodEnd}`
          }
        />
        {p.nextPayment && (
          <Faktas
            pavadinimas="Kita įmoka"
            reiksme={`${p.nextPayment.date} · ${eur(p.nextPayment.cents)}`}
            pastaba={p.nextPayment.estimated ? 'pagal ankstesnius nurašymus' : `pagal grafiką, ${kada(p.nextPayment.date, siandien)}`}
          />
        )}
        {p.lastPayment ? (
          <Faktas
            pavadinimas="Paskutinis nurašymas"
            reiksme={`${p.lastPayment.date} · ${eur(p.lastPayment.cents)}`}
            pastaba="iš banko išrašo"
          />
        ) : praejusiGrafiko ? (
          <Faktas
            pavadinimas="Paskutinė įmoka"
            reiksme={`${praejusiGrafiko.data} · ${eur(praejusiGrafiko.cents)}`}
            pastaba="pagal polisą; to mėnesio banko išrašo appse nėra (tik Excel istorija)"
          />
        ) : (
          <Faktas pavadinimas="Paskutinis nurašymas" reiksme="—" pastaba="banko išrašuose per 14 mėn. nerasta" />
        )}
        <Faktas
          pavadinimas={p.kind === 'gyvybes' ? 'Draudėjas / apdraustasis' : 'Draudėjas'}
          reiksme={p.kind === 'gyvybes' ? `${p.policyholder} / ${p.insured}` : (p.policyholder ?? '—')}
          pastaba={p.beneficiary ? `naudos gavėjas: ${p.beneficiary}` : undefined}
        />
      </dl>

      {p.upcoming && (
        <div className="kreditas-pastaba">
          <strong>
            Nuo {p.upcoming.periodStart} — naujas laikotarpis:{' '}
            {eur(p.upcoming.monthlyCents ?? p.upcoming.premiumCents)}
            {p.upcoming.monthlyCents ? ' per mėnesį' : ' už metus'}
          </strong>
          {p.upcoming.changes.length > 0 && (
            <ul>
              {p.upcoming.changes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {pastabos.length > 0 && (
        <div className="kreditas-pastaba draudimo-pastabos">
          <strong>Atkreipk dėmesį</strong>
          <ul>
            {pastabos.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}

      {p.investment && verte && <Investicija p={p} verte={verte} />}

      <details className="kreditas-skyrius" open>
        <summary>
          Draudimo sumos ir apsauga
          <span>{p.coverages.length} rizikos</span>
        </summary>
        <div className="table-wrap">
          <table className="kredito-lentele">
            <thead>
              <tr>
                <th>Nuo ko apdrausta</th>
                <th className="num">Draudimo suma</th>
                {suIsskaita && <th className="num">Išskaita</th>}
              </tr>
            </thead>
            <tbody>
              {p.coverages.map((c) => (
                <tr key={c.rizika}>
                  <td>
                    {c.rizika}
                    {c.iki && <small className="po-tekstu">galioja iki {c.iki}</small>}
                  </td>
                  <td className="num">{c.suma_cents != null ? eur(c.suma_cents) : (c.suma_tekstas ?? '—')}</td>
                  {suIsskaita && <td className="num">{c.isskaita ?? '—'}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      {p.conditions.length > 0 && (
        <details className="kreditas-skyrius">
          <summary>
            Svarbiausios sąlygos
            <span>{p.conditions.length}</span>
          </summary>
          <ul className="salygu-sarasas">
            {p.conditions.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </details>
      )}

      {p.changes.length > 0 && (
        <details className="kreditas-skyrius">
          <summary>Sutarties pakeitimai</summary>
          <ul className="salygu-sarasas">
            {p.changes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </details>
      )}

      {p.schedule.length > 1 && (
        <details className="kreditas-skyrius">
          <summary>
            Mokėjimo grafikas
            <span>
              {p.schedule.length} įmokos · {eur(suma(p.schedule.map((s) => s.cents)))}
            </span>
          </summary>
          <div className="table-wrap">
            <table className="kredito-lentele">
              <tbody>
                {p.schedule.map((s) => (
                  <tr key={s.data} className={s.data < siandien ? 'menesio-eilute' : undefined}>
                    <td className="nowrap">{s.data}</td>
                    <td className="num">{eur(s.cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </article>
  )
}

function Investicija({
  p,
  verte,
}: {
  p: DraudimoPolisas
  verte: { cents: number; date: string; isSavitarnos: boolean }
}) {
  const a = p.investment!.ataskaita
  const s = p.investment!.savitarna
  const mokesciai = suma(a.mokesciai.map((m) => m.cents))
  const mokesciaiViso = suma(a.mokesciai.map((m) => m.viso_cents))
  const apsaugai = a.imokos_mokestis_cents + mokesciai
  const kaupimui = Math.max(0, a.sumoketa_cents - apsaugai)
  const plotis = (c: number) => `${(Math.max(0, c) / Math.max(1, a.sumoketa_cents)) * 100}%`

  return (
    <div className="draudimo-investicija">
      <h4>Investicinė dalis</h4>
      <dl className="kreditas-faktai">
        <Faktas
          pavadinimas="Sukaupta"
          reiksme={eur(verte.cents)}
          pastaba={
            verte.isSavitarnos
              ? `${verte.date} · ${s.vienetai.toLocaleString('lt-LT', { maximumFractionDigits: 4 })} vnt. × ${s.vieneto_kaina.toLocaleString('lt-LT')} €`
              : `${verte.date} · įvesta pensijų skiltyje`
          }
        />
        <Faktas
          pavadinimas="Sumokėta iš viso"
          reiksme={eur(s.sumoketa_viso_cents)}
          pastaba={p.contractStart ? `nuo ${p.contractStart}` : undefined}
        />
        <Faktas
          pavadinimas="Grąža per 12 mėn."
          reiksme={procentai(s.graza_12men_proc)}
          pastaba={`investicinis pelnas ${eur(s.pelnas_12men_cents)}`}
        />
        <Faktas
          pavadinimas="Išperkamoji suma"
          reiksme={eur(a.isperkamoji_cents)}
          pastaba={`${a.metai}-12-31 — tiek gautum nutraukęs`}
        />
      </dl>

      <div className="grazos-juosta">
        <div
          className="juosta"
          role="img"
          aria-label={`${a.metai} m. iš ${eur(a.sumoketa_cents)} apsaugai ir mokesčiams ${eur(apsaugai)}, kaupimui ${eur(kaupimui)}`}
        >
          <div className="imokos" style={{ width: plotis(apsaugai) }} />
          <div style={{ width: plotis(kaupimui), background: 'var(--serija)' }} />
        </div>
        <div className="grazos-legenda">
          <span>
            <i className="imokos" /> apsaugai ir mokesčiams {eur(apsaugai)} (
            {Math.round((apsaugai / Math.max(1, a.sumoketa_cents)) * 100)} %)
          </span>
          <span>
            <i style={{ background: 'var(--serija)' }} /> liko kaupimui {eur(kaupimui)}
          </span>
        </div>
        <small className="po-tekstu">
          {a.metai} m. sumokėta {eur(a.sumoketa_cents)}. Kapitalas per metus {eur(a.kapitalas_pradzioje_cents)} →{' '}
          {eur(a.kapitalas_pabaigoje_cents)}, iš jų investicinis pelnas {eur(a.pelnas_cents)} ({procentai(a.graza_proc)}).
        </small>
      </div>

      <details className="kreditas-skyrius">
        <summary>
          Kur nuėjo įmokos
          <span>pagal PZU {a.metai} m. ataskaitą</span>
        </summary>
        <div className="table-wrap">
          <table className="kredito-lentele">
            <thead>
              <tr>
                <th>Mokestis</th>
                <th className="num">{a.metai} m.</th>
                <th className="num">Nuo sutarties pradžios</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Įmokos mokestis</td>
                <td className="num">{eur(a.imokos_mokestis_cents)}</td>
                <td className="num">{eur(a.imokos_mokestis_viso_cents)}</td>
              </tr>
              {a.mokesciai.map((m) => (
                <tr key={m.pavadinimas}>
                  <td>{m.pavadinimas}</td>
                  <td className="num">{eur(m.cents)}</td>
                  <td className="num">{eur(m.viso_cents)}</td>
                </tr>
              ))}
              <tr className="metu-eilute">
                <td>Iš viso mokesčių</td>
                <td className="num">{eur(apsaugai)}</td>
                <td className="num">{eur(a.imokos_mokestis_viso_cents + mokesciaiViso)}</td>
              </tr>
              <tr>
                <td>Sumokėta įmokų</td>
                <td className="num">{eur(a.sumoketa_cents)}</td>
                <td className="num">{eur(a.sumoketa_viso_cents)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
