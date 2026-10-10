import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  api,
  eur,
  menuoVardas,
  type BiudzetoRibos,
  type Category,
  type Priminimai as PriminimuDuomenys,
  type Taupymas as TaupymoDuomenys,
  type Transaction,
} from './api'
import Priminimai from './Priminimai'
import Ziedas, { BE_KATEGORIJOS } from './Ziedas'

type ApzvalgosDuomenys = Awaited<ReturnType<typeof api.overview>>

type Props = {
  categories: Category[]
  onOpenGroup: (group: Category) => void
  onEiti: (skiltis: 'biudzetas' | 'turtas' | 'operacijos' | 'importas') => void
}

export default function Pradzia({ categories, onOpenGroup, onEiti }: Props) {
  const [apzvalga, setApzvalga] = useState<ApzvalgosDuomenys | null>(null)
  const [priminimai, setPriminimai] = useState<PriminimuDuomenys | null>(null)
  const [taupymas, setTaupymas] = useState<TaupymoDuomenys | null>(null)
  const [ribos, setRibos] = useState<BiudzetoRibos | null>(null)
  const [operacijos, setOperacijos] = useState<Transaction[]>([])
  const [klaida, setKlaida] = useState<string | null>(null)

  const loadPriminimus = useCallback(() => {
    api
      .reminders()
      .then(setPriminimai)
      .catch(() => setPriminimai(null))
  }, [])

  useEffect(() => {
    api.overview().then(setApzvalga).catch(() => setKlaida('Nepavyko užkrauti apžvalgos.'))
    // Taupymas ir operacijos — papildoma informacija; jų klaida ekrano negriauna.
    api.savings().then(setTaupymas).catch(() => setTaupymas(null))
    api.budgets().then(setRibos).catch(() => setRibos(null))
    api
      .transactions({ limit: '6', hideOffsets: '1' })
      .then((d) => setOperacijos(d.rows))
      .catch(() => setOperacijos([]))
    loadPriminimus()
  }, [loadPriminimus])

  const menuo = apzvalga?.months.at(-1)?.month ?? null

  const { grupes, visosDalys, islaidos, pajamos, nepriskirta } = useMemo(() => {
    if (!apzvalga || !menuo) {
      return {
        grupes: [],
        visosDalys: [] as { id: number; vardas: string; suma: number }[],
        islaidos: 0,
        pajamos: 0,
        nepriskirta: null as null | { suma: number; kiek: number },
      }
    }
    const sioMenesio = apzvalga.cells.filter((c) => c.month === menuo)
    const islaiduCeles = sioMenesio.filter((c) => c.side === 'expense')

    // Žiede turi būti visos išlaidos, įskaitant nepriskirtas — kitaip žiedas
    // neužsidaro ir centre rodoma suma nesutampa su dalimis.
    const visosDalys = islaiduCeles
      .map((c) => ({
        id: c.groupId ?? BE_KATEGORIJOS,
        vardas: c.groupId === null ? 'Be kategorijos' : c.groupName,
        suma: Math.abs(c.amount),
      }))
      .sort((a, b) => b.suma - a.suma)

    const beKategorijos = islaiduCeles.find((c) => c.groupId === null)

    return {
      grupes: visosDalys.filter((d) => d.id >= 0),
      visosDalys,
      islaidos: islaiduCeles.reduce((s, c) => s + Math.abs(c.amount), 0),
      pajamos: sioMenesio.filter((c) => c.side === 'income').reduce((s, c) => s + c.amount, 0),
      nepriskirta: beKategorijos ? { suma: Math.abs(beKategorijos.amount), kiek: beKategorijos.count } : null,
    }
  }, [apzvalga, menuo])

  /** Pokytis nuo praėjusio mėnesio — didžiausias augimas tarp grupių. */
  const augimas = useMemo(() => {
    if (!apzvalga || !menuo) return null
    const menesiai = apzvalga.months.map((m) => m.month)
    const pries = menesiai[menesiai.indexOf(menuo) - 1]
    if (!pries) return null

    const suma = (m: string, groupId: number) =>
      Math.abs(
        apzvalga.cells.find((c) => c.month === m && c.groupId === groupId && c.side === 'expense')?.amount ?? 0
      )

    const kandidatai = grupes
      .filter((g) => suma(pries, g.id) > 2000)
      .map((g) => ({ ...g, buvo: suma(pries, g.id) }))
      .map((g) => ({ ...g, pokytis: (g.suma - g.buvo) / g.buvo }))
      .filter((g) => g.pokytis > 0.15)
      .sort((a, b) => b.pokytis - a.pokytis)

    return kandidatai[0] ? { ...kandidatai[0], pries } : null
  }, [apzvalga, menuo, grupes])

  /** Taupymo tikslas su artimiausiu terminu — kiek liko. */
  const tikslas = useMemo(
    () => taupymas?.goals.find((g) => g.targetCents !== null && (g.leftCents ?? 0) > 0) ?? null,
    [taupymas]
  )

  /** Trumpa biudžeto žinutė: svarbiausia — viršytos ribos, paskui bendras tempas. */
  const biudzetas = useMemo(() => {
    if (!ribos || ribos.totals.plannedCents === 0) return null

    const { totals, dienos } = ribos
    const virsytos = ribos.eilutes.filter((e) => e.busena === 'virsyta')
    const dalis = totals.spentWithLimitCents / totals.plannedCents

    if (virsytos.length > 0) {
      const didziausia = virsytos.reduce((a, b) =>
        (a.leftCents ?? 0) < (b.leftCents ?? 0) ? a : b
      )
      return {
        svarbi: true,
        antraste:
          virsytos.length === 1
            ? `${didziausia.name}: riba viršyta`
            : `Viršytos ${virsytos.length} ribos`,
        paaiskinimas: `${didziausia.name} ${eur(didziausia.spentCents)} iš ${eur(didziausia.plannedCents ?? 0)}`,
      }
    }

    // Tempas: ar išleista daugiau, nei „priklausytų" pagal praėjusias dienas.
    const pirmyn = dalis > dienos.dalis + 0.1
    return {
      svarbi: pirmyn,
      antraste: `Biudžetas ${Math.round(dalis * 100)} %`,
      paaiskinimas: pirmyn
        ? `${eur(totals.spentWithLimitCents)} iš ${eur(totals.plannedCents)} · pagal dienas turėtų būti ${eur(totals.tempasCents)}`
        : `${eur(totals.spentWithLimitCents)} iš ${eur(totals.plannedCents)} · tempas tvarkingas`,
    }
  }, [ribos])

  const grupiuKategorijos = useMemo(
    () => new Map(categories.filter((c) => c.parent_id === null).map((c) => [c.id, c])),
    [categories]
  )

  if (klaida) return <p className="error">{klaida}</p>
  if (!apzvalga) return <p className="tuscia">Kraunama...</p>
  if (!menuo)
    return (
      <div className="tuscia">
        <p>Operacijų dar nėra — pradėk nuo banko išrašo.</p>
        <button onClick={() => onEiti('importas')}>Importuoti banko išrašą</button>
      </div>
    )

  const likutis = pajamos - islaidos
  const siandien = new Date()
  const sisMenuo = menuo === siandien.toISOString().slice(0, 7)
  const likoDienu = sisMenuo
    ? new Date(siandien.getFullYear(), siandien.getMonth() + 1, 0).getDate() - siandien.getDate()
    : null

  return (
    <div className="pradzia">
      <section className="menesio-kortele">
        <header>
          <h2>{menuoVardas(menuo)}</h2>
          {likoDienu !== null && <span className="silpnas">liko {likoDienu} d.</span>}
        </header>

        <Ziedas dalys={visosDalys} />

        <div className="menesio-sumos">
          <div>
            <span>Pajamos</span>
            <b className="num income">{eur(pajamos)}</b>
          </div>
          <div>
            <span>Likutis</span>
            <b className={likutis < 0 ? 'num neigiamas' : 'num income'}>{eur(likutis)}</b>
          </div>
        </div>
      </section>

      {priminimai && <Priminimai duomenys={priminimai} onChanged={loadPriminimus} />}

      <section className="izvalgos">
        {biudzetas && (
          <button
            className={`izvalga ${biudzetas.svarbi ? 'svarbi' : ''}`}
            onClick={() => onEiti('biudzetas')}
          >
            <span className="zenklas" aria-hidden="true">▤</span>
            <span>
              <b>{biudzetas.antraste}</b>
              <small>{biudzetas.paaiskinimas}</small>
            </span>
          </button>
        )}

        {taupymas && taupymas.totals.valueCents > 0 && (
          <button className="izvalga" onClick={() => onEiti('turtas')}>
            <span className="zenklas" aria-hidden="true">↗</span>
            <span>
              <b>
                Portfelis {eur(taupymas.totals.valueCents)}
                {taupymas.totals.gainPct !== null && ` · ${taupymas.totals.gainPct > 0 ? '+' : ''}${taupymas.totals.gainPct.toLocaleString('lt-LT', { maximumFractionDigits: 2 })} %`}
              </b>
              <small>
                {eur(taupymas.totals.fundsValueCents)} fonduose · {eur(taupymas.totals.cashCents)} grynais
              </small>
            </span>
          </button>
        )}

        {augimas && (
          <button className="izvalga svarbi" onClick={() => onEiti('biudzetas')}>
            <span className="zenklas" aria-hidden="true">△</span>
            <span>
              <b>
                {augimas.vardas} +{Math.round(augimas.pokytis * 100)} %
              </b>
              <small>
                {eur(augimas.suma)} · prieš tai {eur(augimas.buvo)} ({menuoVardas(augimas.pries, true)})
              </small>
            </span>
          </button>
        )}

        {tikslas && (
          <button className="izvalga" onClick={() => onEiti('turtas')}>
            <span className="zenklas" aria-hidden="true">◷</span>
            <span>
              <b>
                {tikslas.name}: liko {eur(tikslas.leftCents ?? 0)}
              </b>
              <small>
                sukaupta {eur(tikslas.valueCents)} iš {eur(tikslas.targetCents ?? 0)}
                {tikslas.monthsLeft !== null && ` · ${tikslas.monthsLeft} mėn.`}
              </small>
            </span>
          </button>
        )}

        {nepriskirta && nepriskirta.kiek > 0 && (
          <button className="izvalga svarbi" onClick={() => onEiti('operacijos')}>
            <span className="zenklas" aria-hidden="true">?</span>
            <span>
              <b>Nepriskirta {nepriskirta.kiek} oper.</b>
              <small>{eur(nepriskirta.suma)} laukia kategorijos</small>
            </span>
          </button>
        )}
      </section>

      <section className="kortele-sarasas">
        <header>
          <h2>Grupės</h2>
          <button className="linkish" onClick={() => onEiti('biudzetas')}>
            visos →
          </button>
        </header>
        <ul>
          {grupes.slice(0, 6).map((g) => {
            const kategorija = grupiuKategorijos.get(g.id)
            return (
              <li key={g.id}>
                <button
                  className="sarasas-eilute"
                  onClick={() => kategorija && onOpenGroup(kategorija)}
                  disabled={!kategorija}
                >
                  <span className="vardas">{g.vardas}</span>
                  <span className="num suma">{eur(g.suma)}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </section>

      {operacijos.length > 0 && (
        <section className="kortele-sarasas">
          <header>
            <h2>Naujausios operacijos</h2>
            <button className="linkish" onClick={() => onEiti('operacijos')}>
              visos →
            </button>
          </header>
          <ul>
            {operacijos.map((t) => (
              <li key={t.id}>
                <div className="sarasas-eilute nespaudziama">
                  <span className="vardas">
                    {t.counterparty_name ?? t.description?.slice(0, 40) ?? '—'}
                    <small>
                      {t.booking_date} · {t.category_name ?? 'be kategorijos'}
                    </small>
                  </span>
                  <span className={t.amount_cents > 0 ? 'num suma income' : 'num suma'}>
                    {eur(t.amount_cents + t.offset_cents)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
