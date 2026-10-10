import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  api,
  eur,
  menuoVardas,
  type Category,
  type Draudimai as DraudimuDuomenys,
  type GrupesLangelis,
  type Kreditas,
  type Pensijos as PensijuDuomenys,
  type Taupymas as TaupymoDuomenys,
  type Transaction,
} from './api'
import Draudimai from './Draudimai'
import GrupesAnalize, { PokycioZyme } from './GrupesAnalize'
import { grupesEilutes, perkeltiMenesi, pokytis, suPoskyriais, type GrupesEilute } from './grupesSkaiciavimai'
import Kreditai from './Kreditai'
import { operacijosDetales } from './operacijosDetales'
import ProjektoPriskyrimas from './ProjektoPriskyrimas'
import Pensijos, { PensijuSantrauka } from './Pensijos'
import SkaidymoDialogas from './SkaidymoDialogas'
import SudengimoDialogas from './SudengimoDialogas'
import SudengimoIsklotine from './SudengimoIsklotine'
import Taupymas from './Taupymas'

type Props = {
  group: Category
  categories: Category[]
  onBack: () => void
}

type Rodinys = 'sumos' | 'men' | 'metai'

const RODINIAI: [Rodinys, string][] = [
  ['sumos', 'Sumos'],
  ['men', 'Pokytis nuo praėjusio mėn.'],
  ['metai', 'Pokytis per metus'],
]

/** Vienos grupės istorija: kategorijos eilutėmis, mėnesiai stulpeliais. */
export default function Grupe({ group, categories, onBack }: Props) {
  const [cells, setCells] = useState<GrupesLangelis[] | null>(null)
  const [pasirinkta, setPasirinkta] = useState<{ categoryId: number; month: string } | null>(null)
  const [operacijos, setOperacijos] = useState<Transaction[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const lentele = useRef<HTMLDivElement>(null)
  const [kreditai, setKreditai] = useState<Kreditas[]>([])
  const [rodinys, setRodinys] = useState<Rodinys>('sumos')
  const pajamos = group.type === 'income'

  useEffect(() => {
    api
      .credits()
      .then(setKreditai)
      .catch(() => setError('Nepavyko užkrauti kreditų duomenų.'))
  }, [])

  const [draudimai, setDraudimai] = useState<DraudimuDuomenys | null>(null)
  useEffect(() => {
    api
      .insurance()
      .then(setDraudimai)
      .catch(() => setError('Nepavyko užkrauti draudimų duomenų.'))
  }, [])

  const savuIds = useMemo(
    () => new Set(categories.filter((c) => c.parent_id === group.id || c.id === group.id).map((c) => c.id)),
    [categories, group.id]
  )

  /** Kreditai, kurių nurašymai patenka į šios grupės kategorijas. */
  const grupesKreditai = useMemo(
    () => kreditai.filter((k) => k.categoryIds.some((id) => savuIds.has(id))),
    [kreditai, savuIds]
  )

  const [pensijos, setPensijos] = useState<PensijuDuomenys | null>(null)
  const pensijuGrupe = group.name === 'Pensijos' && group.parent_id === null

  const loadPensijos = useCallback(
    () =>
      api
        .pensions()
        .then(setPensijos)
        .catch(() => {
          // Kitose grupėse pensijų santrauka tik papildoma — jos klaida netrukdo.
          if (pensijuGrupe) setError('Nepavyko užkrauti pensijų duomenų.')
        }),
    [pensijuGrupe]
  )

  useEffect(() => {
    loadPensijos()
  }, [loadPensijos])

  // Kainos atnaujinamos fone — po kelių sekundžių parodomos naujos.
  const kainosAtnaujinamos = pensijos?.refreshingPrices ?? false
  useEffect(() => {
    if (!kainosAtnaujinamos) return
    const laikmatis = setTimeout(() => {
      api
        .pensions()
        .then((p) => setPensijos({ ...p, refreshingPrices: false }))
        .catch(() => undefined)
    }, 6000)
    return () => clearTimeout(laikmatis)
  }, [kainosAtnaujinamos])

  const rodytiPensijas = pensijuGrupe && pensijos !== null && pensijos.groupId === group.id
  /** Pvz. „Draudimas" grupėje — PZU sukaupta suma iš pensijų skilties. */
  const susijePensijuProduktai =
    pensijos && !pensijuGrupe
      ? pensijos.products.filter((p) => p.contributionCategoryId !== null && savuIds.has(p.contributionCategoryId))
      : []

  const [taupymas, setTaupymas] = useState<TaupymoDuomenys | null>(null)
  const taupymoGrupe = group.name === 'Taupymas' && group.parent_id === null

  const loadTaupyma = useCallback(() => {
    if (!taupymoGrupe) return Promise.resolve()
    return api
      .savings()
      .then(setTaupymas)
      .catch(() => setError('Nepavyko užkrauti taupymo duomenų.'))
  }, [taupymoGrupe])

  useEffect(() => {
    loadTaupyma()
  }, [loadTaupyma])

  const [splitFor, setSplitFor] = useState<Transaction | null>(null)
  const [offsetFor, setOffsetFor] = useState<Transaction | null>(null)
  const [isskleista, setIsskleista] = useState<number | null>(null)

  const loadCells = useCallback(() => {
    return api
      .groupOverview(group.id)
      .then(setCells)
      .catch(() => setError('Nepavyko užkrauti grupės duomenų.'))
  }, [group.id])

  useEffect(() => {
    loadCells()
  }, [loadCells])

  // Naujausi mėnesiai svarbiausi, tad lentelė iškart atsukama į dešinę.
  useEffect(() => {
    if (cells && lentele.current) lentele.current.scrollLeft = lentele.current.scrollWidth
  }, [cells])

  const { menesiai, eilutes } = useMemo(() => grupesEilutes(cells ?? []), [cells])
  const savos = eilutes.filter((e) => !e.related)
  const susijusios = eilutes.filter((e) => e.related)

  /** Draudimo sutartys, kurių įmokos patenka į šios grupės kategorijas. */
  const grupesDraudimai =
    draudimai?.policies.filter((p) => p.paymentCategoryId !== null && savuIds.has(p.paymentCategoryId)) ?? []
  /** Primestos per kitų grupių kategorijas (pvz. automobilio draudimai prie „Automobilis"). */
  const susijeDraudimai =
    draudimai?.policies.filter(
      (p) =>
        p.paymentCategoryId !== null &&
        !savuIds.has(p.paymentCategoryId) &&
        susijusios.some((e) => e.id === p.paymentCategoryId)
    ) ?? []
  // PZU sukaupta suma rodoma draudimo kortelėje, tad atskiros santraukos nebereikia.
  const pensijuSantrauka = susijePensijuProduktai.filter(
    (p) => !grupesDraudimai.some((d) => d.pensionProductCode === p.code)
  )

  /** Kreditai, primesti per kitų grupių kategorijas (pvz. lizingas prie automobilio). */
  const susijeKreditai = kreditai.filter(
    (k) => !grupesKreditai.includes(k) && k.categoryIds.some((id) => susijusios.some((e) => e.id === id))
  )

  const turimiMenesiai = new Set(menesiai)
  const suma = (rows: GrupesEilute[], m: string) => rows.reduce((s, e) => s + (e.pagalMenesi.get(m) ?? 0), 0)

  /** Pokyčio žymė langelyje pagal pasirinktą rodinį. */
  function zyme(gauti: (m: string) => number | undefined, m: string) {
    if (rodinys === 'sumos') return null
    const pries = perkeltiMenesi(m, rodinys === 'men' ? -1 : -12)
    const kryptis = pajamos ? 1 : -1
    const dabar = gauti(m)
    const buvo = gauti(pries)
    return (
      <PokycioZyme
        santykis={pokytis(dabar === undefined ? undefined : kryptis * dabar, buvo === undefined ? undefined : kryptis * buvo)}
        pajamos={pajamos}
      />
    )
  }

  const atidarytiCele = useCallback(async (categoryId: number, month: string) => {
    setPasirinkta({ categoryId, month })
    setOperacijos(null)
    const paskutine = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)
    try {
      const data = await api.transactions({
        categoryId: String(categoryId),
        from: `${month}-01`,
        to: `${month}-${String(paskutine.getDate()).padStart(2, '0')}`,
        hideOffsets: '1',
        limit: '200',
      })
      setOperacijos(data.rows)
    } catch {
      setError('Nepavyko užkrauti operacijų.')
    }
  }, [])

  async function perkrauti() {
    await loadCells()
    if (pasirinkta) await atidarytiCele(pasirinkta.categoryId, pasirinkta.month)
  }

  async function atsauktiSkaidyma(parentId: number) {
    if (!confirm('Atšaukti skaidymą? Visos dalys bus sujungtos atgal į vieną operaciją be kategorijos.')) return
    try {
      await api.unsplitTransaction(parentId)
      await perkrauti()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nepavyko atšaukti skaidymo.')
    }
  }

  async function atsieti(incomeId: number) {
    if (!confirm('Atsieti sudengimą? Įplauka vėl bus rodoma kaip nepriskirta įplauka.')) return
    try {
      await api.unlinkOffset(incomeId)
      await perkrauti()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nepavyko atsieti sudengimo.')
    }
  }

  const pasirinktaKategorija = pasirinkta ? categories.find((c) => c.id === pasirinkta.categoryId) : null

  function kategorijosEilute(eilute: GrupesEilute) {
    return (
      <tr key={eilute.id} className={eilute.related ? 'susijusi' : eilute.subgroup ? 'poskyrio-kategorija' : undefined}>
        <td>
          {eilute.name}
          {eilute.related && <small className="po-tekstu">iš „{eilute.originGroupName}“</small>}
        </td>
        {menesiai.map((m) => {
          const s = eilute.pagalMenesi.get(m)
          const aktyvi = pasirinkta?.categoryId === eilute.id && pasirinkta?.month === m
          return (
            <td key={m} className="num">
              {s === undefined ? (
                <span className="tuscia-cele">—</span>
              ) : (
                <>
                  <button
                    className={aktyvi ? 'linkish pasirinktas' : 'linkish'}
                    onClick={() => atidarytiCele(eilute.id, m)}
                  >
                    {eur(s)}
                  </button>
                  {zyme((x) => eilute.pagalMenesi.get(x), m)}
                </>
              )}
            </td>
          )
        })}
      </tr>
    )
  }

  function sumosEilute(pavadinimas: string, rows: GrupesEilute[], klase = 'likutis') {
    const gauti = (m: string) => (turimiMenesiai.has(m) ? suma(rows, m) : undefined)
    return (
      <tr key={`suma-${pavadinimas}`} className={klase}>
        <td>{pavadinimas}</td>
        {menesiai.map((m) => (
          <td key={m} className="num">
            {eur(suma(rows, m))}
            {zyme(gauti, m)}
          </td>
        ))}
      </tr>
    )
  }

  return (
    <section>
      <div className="grupes-antraste">
        <button className="ghost small" onClick={onBack}>
          ← Atgal
        </button>
        <h2>{group.name}</h2>
      </div>

      {error && <p className="error">{error}</p>}
      {grupesKreditai.length > 0 && <Kreditai kreditai={grupesKreditai} />}
      {rodytiPensijas && pensijos && <Pensijos duomenys={pensijos} onChanged={loadPensijos} />}
      {taupymoGrupe && taupymas && <Taupymas duomenys={taupymas} onChanged={loadTaupyma} />}
      {draudimai && grupesDraudimai.length > 0 && (
        <Draudimai duomenys={draudimai} polisai={grupesDraudimai} pensijos={pensijos} />
      )}
      {pensijuSantrauka.length > 0 && <PensijuSantrauka produktai={pensijuSantrauka} />}
      {draudimai && susijeDraudimai.length > 0 && (
        <details className="kreditas-skyrius susije-kreditai">
          <summary>
            Draudimai: {susijeDraudimai.map((p) => p.kindLabel).join(', ')}
            <span>
              iš „Draudimas“ skilties · {eur(susijeDraudimai.reduce((s, p) => s + p.monthlyEquivalentCents, 0))} / mėn.
            </span>
          </summary>
          <Draudimai duomenys={draudimai} polisai={susijeDraudimai} pensijos={pensijos} />
        </details>
      )}
      {susijeKreditai.length > 0 && (
        <details className="kreditas-skyrius susije-kreditai">
          <summary>
            {susijeKreditai.map((k) => k.name).join(', ')}
            <span>
              iš „Kreditai“ skilties · likutis {eur(susijeKreditai.reduce((s, k) => s + k.balanceCents, 0))} · įmoka{' '}
              {eur(susijeKreditai.reduce((s, k) => s + k.monthlyPaymentCents, 0))} / mėn.
            </span>
          </summary>
          <Kreditai kreditai={susijeKreditai} />
        </details>
      )}
      {/* Taupymo grupėje mėnesių lentelės nereikia: tuos pačius pinigus geriau
          parodo taupymo skiltis, o kategorijose liko tik sena Excel istorija. */}
      {!taupymoGrupe && !cells && <p className="tuscia">Kraunama...</p>}

      {!taupymoGrupe && cells && menesiai.length === 0 && (
        <p className="tuscia">Šioje grupėje operacijų dar nėra.</p>
      )}

      {!taupymoGrupe && cells && menesiai.length > 0 && (
        <>
          <GrupesAnalize key={group.id} eilutes={eilutes} menesiai={menesiai} pajamos={pajamos} />

          <h3 className="skyriaus-antraste">
            {grupesKreditai.length > 0 || rodytiPensijas ? 'Įmokos pagal mėnesius' : 'Pagal mėnesius'}
          </h3>
          <div className="lenteles-irankiai">
            <p className="paaiskinimas">
              Slink į šoną, kad matytum ankstesnius laikotarpius. Paspaudus sumą matysi tos kategorijos operacijas tą
              mėnesį.
            </p>
            <div className="perjungiklis" role="group" aria-label="Ką rodyti lentelėje">
              {RODINIAI.map(([v, tekstas]) => (
                <button key={v} type="button" aria-pressed={rodinys === v} onClick={() => setRodinys(v)}>
                  {tekstas}
                </button>
              ))}
            </div>
          </div>

          <div className="table-wrap" ref={lentele}>
            <table className="suvestine">
              <thead>
                <tr>
                  <th></th>
                  {menesiai.map((m) => (
                    <th key={m} className="num nowrap">
                      {menuoVardas(m, true)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {suPoskyriais(savos).map((x) =>
                  'poskyris' in x ? (
                    <Fragment key={`poskyris-${x.poskyris}`}>
                      {sumosEilute(x.poskyris, x.eilutes, 'poskyris')}
                      {x.eilutes.map(kategorijosEilute)}
                    </Fragment>
                  ) : (
                    kategorijosEilute(x)
                  )
                )}
                {sumosEilute(susijusios.length > 0 ? 'Suma biudžetui' : 'Viso', savos)}

                {susijusios.length > 0 && (
                  <>
                    <tr className="susijusi-antraste">
                      <td>Primesta iš kitų skilčių</td>
                      {menesiai.map((m) => (
                        <td key={m} />
                      ))}
                    </tr>
                    {susijusios.map(kategorijosEilute)}
                    {sumosEilute('Bendra suma', eilutes)}
                  </>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {pasirinkta && (
        <div className="celes-operacijos">
          <h3>
            {pasirinktaKategorija?.name} · {menuoVardas(pasirinkta.month)}
          </h3>

          {!operacijos && <p className="tuscia">Kraunama...</p>}

          {operacijos && operacijos.length === 0 && <p className="tuscia">Operacijų nerasta.</p>}

          {operacijos && operacijos.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Gavėjas</th>
                    <th className="num">Suma</th>
                    <th>Sąskaita</th>
                    <th className="tight"></th>
                  </tr>
                </thead>
                <tbody>
                  {operacijos.map((t) => (
                    <Fragment key={t.id}>
                      <tr className={isskleista === t.id ? 'picked' : undefined}>
                        <td className="nowrap">{t.booking_date}</td>
                        <td>
                          <button
                            className="linkish"
                            onClick={() => setIsskleista(isskleista === t.id ? null : t.id)}
                            aria-expanded={isskleista === t.id}
                            title="Rodyti banko informaciją"
                          >
                            {t.counterparty_name ?? t.description?.slice(0, 45) ?? '—'}
                          </button>
                          {t.notes === 'excel-istorija' && <span className="tag">istorinė suma</span>}
                          {t.parent_id !== null && (
                            <span className="tag">
                              {t.parent_booking_date && t.parent_booking_date !== t.booking_date
                                ? `dalis, perkelta iš ${t.parent_booking_date}`
                                : 'skaidymo dalis'}
                            </span>
                          )}
                          {t.offsets.length > 0 && (
                            <SudengimoIsklotine amountCents={t.amount_cents} offsets={t.offsets} onUnlink={atsieti} />
                          )}
                        </td>
                        <td className={t.amount_cents > 0 ? 'num income' : 'num'}>
                          {eur(t.amount_cents + t.offset_cents)}
                        </td>
                        <td className="nowrap">
                          {t.account_owner ?? '—'}
                          {t.iban_last4 ? ` ···${t.iban_last4}` : ''}
                        </td>
                        <td className="tight nowrap">
                          <button className="ghost small" onClick={() => setOffsetFor(t)}>
                            {t.amount_cents < 0 ? 'sudengti' : 'sudengti su išlaida'}
                          </button>{' '}
                          {t.offsets.length > 0 ? null : t.parent_id === null ? (
                            <button className="ghost small" onClick={() => setSplitFor(t)}>
                              skaidyti
                            </button>
                          ) : (
                            <button className="ghost small" onClick={() => atsauktiSkaidyma(t.parent_id!)}>
                              atšaukti skaidymą
                            </button>
                          )}
                        </td>
                      </tr>
                      {isskleista === t.id && (
                        <tr className="detail">
                          <td colSpan={5}>
                            <dl>
                              {operacijosDetales(t).map((d) => (
                                <Fragment key={d.etikete}>
                                  <dt>{d.etikete}</dt>
                                  <dd>{d.reiksme}</dd>
                                </Fragment>
                              ))}
                            </dl>
                            <ProjektoPriskyrimas operacija={t} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {offsetFor && (
        <SudengimoDialogas
          transaction={offsetFor}
          onClose={() => setOffsetFor(null)}
          onSaved={async () => {
            setOffsetFor(null)
            await perkrauti()
          }}
        />
      )}

      {splitFor && (
        <SkaidymoDialogas
          transaction={splitFor}
          categories={categories}
          onClose={() => setSplitFor(null)}
          onSaved={async () => {
            setSplitFor(null)
            await perkrauti()
          }}
        />
      )}
    </section>
  )
}
