import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, eur, menuoVardas, type Category, type Transaction } from './api'
import BiudzetoRibos from './BiudzetoRibos'
import KategorijuMedis, { type MedzioEilute } from './KategorijuMedis'
import Stulpeliai from './Stulpeliai'
import Ziedas, { BE_KATEGORIJOS } from './Ziedas'
import SkaidymoDialogas from './SkaidymoDialogas'
import SudengimoDialogas from './SudengimoDialogas'
import TaisyklesDialogas from './TaisyklesDialogas'
import { useSiauras } from './ekranas'
import { operacijosDetales } from './operacijosDetales'

type Overview = {
  months: { month: string; income: number; expense: number }[]
  cells: {
    month: string
    groupId: number | null
    groupName: string
    side: 'income' | 'expense'
    amount: number
    count: number
  }[]
}

type Props = { categories: Category[]; onOpenGroup: (group: Category) => void }

/** Vaizdas įsimenamas — vieni mėgsta žiedą, kiti Excel tipo lentelę. */
type Vaizdas = 'menuo' | 'laikas' | 'lentele'

const VAIZDAI: [Vaizdas, string][] = [
  ['menuo', 'Mėnuo'],
  ['laikas', 'Per laiką'],
  ['lentele', 'Lentelė'],
]

/** Kiek mėnesių rodoma stulpelinėje diagramoje. Telefone mažiau — kitaip
 *  stulpeliai susispaudžia, o reikšmės užlipa viena ant kitos. */
const STULPELIU_MENESIU = 12
const STULPELIU_MENESIU_SIAURAI = 6

export default function Apzvalga({ categories, onOpenGroup }: Props) {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [pasirinktas, setPasirinktas] = useState<string | null>(null)
  const [operacijos, setOperacijos] = useState<Transaction[]>([])
  const [ruleFor, setRuleFor] = useState<MedzioEilute | null>(null)
  const [splitFor, setSplitFor] = useState<Transaction | null>(null)
  const [offsetFor, setOffsetFor] = useState<Transaction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const siauras = useSiauras()

  const [vaizdas, setVaizdas] = useState<Vaizdas>(() => {
    const issaugotas = localStorage.getItem('biudzeto-vaizdas')
    return issaugotas === 'laikas' || issaugotas === 'lentele' ? issaugotas : 'menuo'
  })

  useEffect(() => {
    localStorage.setItem('biudzeto-vaizdas', vaizdas)
  }, [vaizdas])
  const lentele = useRef<HTMLDivElement>(null)

  // Naujausi mėnesiai svarbiausi, tad lentelė iškart atsukama į dešinę — ir tada, kai į
  // „Lentelė“ perjungiama iš kito vaizdo (lentelė tada sukuriama iš naujo).
  useEffect(() => {
    if (overview && lentele.current) lentele.current.scrollLeft = lentele.current.scrollWidth
  }, [overview, siauras, vaizdas])

  const load = useCallback(async () => {
    try {
      const data = await api.overview()
      setOverview(data)
      setPasirinktas((dabar) => dabar ?? data.months.at(-1)?.month ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nepavyko užkrauti apžvalgos.')
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const loadMenesi = useCallback(async (month: string) => {
    const paskutine = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)
    const data = await api.transactions({
      from: `${month}-01`,
      to: `${month}-${String(paskutine.getDate()).padStart(2, '0')}`,
      includeTransfers: '1',
      // Sudengimai rodomi prie savo išlaidos, ne kaip atskiros įplaukos.
      hideOffsets: '1',
      limit: '500',
    })
    setOperacijos(data.rows)
  }, [])

  useEffect(() => {
    if (pasirinktas) loadMenesi(pasirinktas).catch(() => setError('Nepavyko užkrauti mėnesio operacijų.'))
  }, [pasirinktas, loadMenesi])

  /** Grupių eilutės ta pačia tvarka kaip kategorijų kataloge. */
  const eilutes = useMemo(() => {
    if (!overview) return []
    const grupiuInfo = new Map(categories.filter((c) => !c.parent_id).map((c) => [c.id, c]))
    const grupes = new Map<
      string,
      { id: number | null; name: string; pajamos: boolean; pagalMenesi: Map<string, number> }
    >()

    for (const cell of overview.cells) {
      const raktas = `${cell.groupId ?? 'be'}|${cell.side}`
      if (!grupes.has(raktas)) {
        grupes.set(raktas, {
          id: cell.groupId,
          name: cell.groupName,
          pajamos: cell.side === 'income',
          pagalMenesi: new Map(),
        })
      }
      grupes.get(raktas)!.pagalMenesi.set(cell.month, cell.amount)
    }

    // Išlaidų grupė rodoma ir be operacijų (pvz. „Pensijos"), kad į jos ekraną visada būtų galima patekti.
    for (const grupe of grupiuInfo.values()) {
      const raktas = `${grupe.id}|expense`
      if (grupe.type === 'expense' && !grupes.has(raktas)) {
        grupes.set(raktas, { id: grupe.id, name: grupe.name, pajamos: false, pagalMenesi: new Map() })
      }
    }

    return [...grupes.values()].sort((a, b) => {
      if (a.id === null) return 1
      if (b.id === null) return -1
      return (grupiuInfo.get(a.id)?.sort_order ?? 0) - (grupiuInfo.get(b.id)?.sort_order ?? 0)
    })
  }, [overview, categories])

  /**
   * Sumos skaičiuojamos iš tų pačių eilučių, kurios matomos lentelėje — kitaip
   * „Pajamos" viršuje ir pajamų grupė apačioje rodytų skirtingus skaičius, o
   * likutis nesutaptų su tuo, ką matai.
   */
  const sumos = useMemo(() => {
    const pagalMenesi = new Map<string, { pajamos: number; islaidos: number }>()
    for (const m of overview?.months ?? []) pagalMenesi.set(m.month, { pajamos: 0, islaidos: 0 })

    for (const grupe of eilutes) {
      for (const [menuo, suma] of grupe.pagalMenesi) {
        const irasas = pagalMenesi.get(menuo)
        if (!irasas) continue
        if (grupe.pajamos) irasas.pajamos += suma
        else irasas.islaidos += suma
      }
    }
    return pagalMenesi
  }, [eilutes, overview])

  /** Pasirinkto mėnesio išlaidos pagal grupes — žiedui. */
  const ziedoDalys = useMemo(() => {
    if (!pasirinktas) return []
    return eilutes
      .filter((g) => !g.pajamos)
      .map((g) => ({
        id: g.id ?? BE_KATEGORIJOS,
        vardas: g.id === null ? 'Be kategorijos' : g.name,
        suma: Math.abs(g.pagalMenesi.get(pasirinktas) ?? 0),
      }))
      .filter((d) => d.suma > 0)
  }, [eilutes, pasirinktas])

  /** Visų mėnesių išlaidos — stulpelinei diagramai. */
  const stulpeliai = useMemo(
    () =>
      (overview?.months ?? [])
        .map((m) => ({ month: m.month, suma: Math.abs(sumos.get(m.month)?.islaidos ?? 0) }))
        .slice(-(siauras ? STULPELIU_MENESIU_SIAURAI : STULPELIU_MENESIU)),
    [overview, sumos, siauras]
  )

  const medzioEilutes: MedzioEilute[] = useMemo(
    () =>
      operacijos.map((t) => ({
        key: String(t.id),
        bookingDate: t.booking_date,
        counterpartyName: t.counterparty_name,
        description: t.description,
        amountCents: t.amount_cents,
        categoryId: t.category_id,
        isTransfer: t.is_transfer === 1,
        ignored: false,
        isSplitPart: t.parent_id !== null,
        movedFrom: t.parent_booking_date !== t.booking_date ? t.parent_booking_date : null,
        offsetCents: t.offset_cents,
        offsets: t.offsets,
        detales: operacijosDetales(t),
      })),
    [operacijos]
  )

  async function perkrauti() {
    await Promise.all([load(), pasirinktas ? loadMenesi(pasirinktas) : Promise.resolve()])
  }

  async function atsauktiSkaidyma(row: MedzioEilute) {
    const dalis = operacijos.find((t) => String(t.id) === row.key)
    if (!dalis?.parent_id) return
    if (!confirm('Atšaukti skaidymą? Visos dalys bus sujungtos atgal į vieną operaciją be kategorijos.')) return
    try {
      await api.unsplitTransaction(dalis.parent_id)
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

  async function keistiKategorija(keys: string[], value: number | null | 'transfer') {
    const ids = keys.map(Number)
    try {
      if (value === 'transfer') await api.updateTransactions({ ids, isTransfer: true })
      else await api.updateTransactions({ ids, categoryId: value })
      await Promise.all([load(), pasirinktas ? loadMenesi(pasirinktas) : Promise.resolve()])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nepavyko pakeisti kategorijos.')
    }
  }

  if (error) return <p className="error">{error}</p>
  if (!overview) return <p className="tuscia">Kraunama...</p>
  if (overview.months.length === 0) {
    return <p className="tuscia">Operacijų dar nėra — pradėk nuo išrašo importo.</p>
  }

  const menesiai = overview.months

  const indeksas = menesiai.findIndex((m) => m.month === pasirinktas)

  return (
    <section>
      <div className="vaizdo-juosta">
        <div className="perjungiklis" role="group" aria-label="Vaizdas">
          {VAIZDAI.map(([v, tekstas]) => (
            <button key={v} type="button" aria-pressed={vaizdas === v} onClick={() => setVaizdas(v)}>
              {tekstas}
            </button>
          ))}
        </div>
      </div>

      {vaizdas === 'menuo' && pasirinktas && (
        <div className="menesio-juosta">
          <button
            className="ghost"
            disabled={indeksas <= 0}
            onClick={() => setPasirinktas(menesiai[indeksas - 1].month)}
            aria-label="Ankstesnis mėnuo"
          >
            ‹
          </button>
          <strong>{menuoVardas(pasirinktas)}</strong>
          <button
            className="ghost"
            disabled={indeksas < 0 || indeksas >= menesiai.length - 1}
            onClick={() => setPasirinktas(menesiai[indeksas + 1].month)}
            aria-label="Kitas mėnuo"
          >
            ›
          </button>
        </div>
      )}

      {vaizdas === 'menuo' && pasirinktas && ziedoDalys.length > 0 && (
        <section className="menesio-kortele">
          <Ziedas dalys={ziedoDalys} />
          <div className="menesio-sumos">
            <div>
              <span>Pajamos</span>
              <b className="num income">{eur(sumos.get(pasirinktas)?.pajamos ?? 0)}</b>
            </div>
            <div>
              <span>Likutis</span>
              <b
                className={
                  (sumos.get(pasirinktas)?.pajamos ?? 0) + (sumos.get(pasirinktas)?.islaidos ?? 0) < 0
                    ? 'num neigiamas'
                    : 'num income'
                }
              >
                {eur((sumos.get(pasirinktas)?.pajamos ?? 0) + (sumos.get(pasirinktas)?.islaidos ?? 0))}
              </b>
            </div>
          </div>
        </section>
      )}

      {vaizdas === 'menuo' && pasirinktas && (
        <BiudzetoRibos menuo={pasirinktas} onPakeista={load} />
      )}

      {vaizdas === 'laikas' && (
        <section className="menesio-kortele">
          <header>
            <h2>Išlaidos per mėnesius</h2>
            <span className="silpnas">paspaudus stulpelį atsidaro tas mėnuo</span>
          </header>
          <Stulpeliai
            menesiai={stulpeliai}
            pasirinktas={pasirinktas}
            onPasirinkti={(m) => {
              setPasirinktas(m)
              setVaizdas('menuo')
            }}
            ariaLabel="Išlaidos pagal mėnesius"
          />
        </section>
      )}

      {vaizdas === 'lentele' && (
      <div className="table-wrap" ref={lentele}>
        <table className="suvestine">
          <thead>
            <tr>
              <th></th>
              {menesiai.map((m) => (
                <th key={m.month} className="num">
                  <button
                    className={m.month === pasirinktas ? 'linkish pasirinktas' : 'linkish'}
                    onClick={() => setPasirinktas(m.month)}
                  >
                    {menuoVardas(m.month)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {eilutes
              .filter((g) => g.pajamos && g.id !== null)
              .map((grupe) => (
                <tr key={grupe.id}>
                  <td>
                    <button
                      className="linkish"
                      onClick={() => {
                        const g = categories.find((c) => c.id === grupe.id)
                        if (g) onOpenGroup(g)
                      }}
                    >
                      {grupe.name}
                    </button>
                  </td>
                  {menesiai.map((m) => {
                    const suma = grupe.pagalMenesi.get(m.month)
                    return (
                      <td key={m.month} className="num income">
                        {suma === undefined ? '—' : eur(suma)}
                      </td>
                    )
                  })}
                </tr>
              ))}

            {eilutes
              .filter((g) => g.pajamos && g.id === null)
              .map((grupe) => (
                <tr key="be-pajamos" className="trukumas">
                  <td>{grupe.name}</td>
                  {menesiai.map((m) => {
                    const suma = grupe.pagalMenesi.get(m.month)
                    return (
                      <td key={m.month} className="num">
                        {suma === undefined ? '—' : eur(suma)}
                      </td>
                    )
                  })}
                </tr>
              ))}

            <tr className="pajamu-eilute">
              <td>Pajamos iš viso</td>
              {menesiai.map((m) => (
                <td key={m.month} className="num income">
                  {eur(sumos.get(m.month)?.pajamos ?? 0)}
                </td>
              ))}
            </tr>

            <tr className="tarpine">
              <td colSpan={menesiai.length + 1}>Išlaidos</td>
            </tr>

            {eilutes.filter((g) => !g.pajamos).map((grupe) => (
              <tr key={grupe.id ?? 'be'} className={grupe.id === null ? 'trukumas' : undefined}>
                <td>
                  {grupe.id === null ? (
                    grupe.name
                  ) : (
                    <button
                      className="linkish"
                      onClick={() => {
                        const g = categories.find((c) => c.id === grupe.id)
                        if (g) onOpenGroup(g)
                      }}
                    >
                      {grupe.name}
                    </button>
                  )}
                </td>
                {menesiai.map((m) => {
                  const suma = grupe.pagalMenesi.get(m.month)
                  return (
                    <td key={m.month} className="num">
                      {suma === undefined ? '—' : eur(suma)}
                    </td>
                  )
                })}
              </tr>
            ))}

            <tr className="tarpine-suma">
              <td>Iš viso išlaidų</td>
              {menesiai.map((m) => (
                <td key={m.month} className="num">
                  {eur(sumos.get(m.month)?.islaidos ?? 0)}
                </td>
              ))}
            </tr>

            <tr className="likutis">
              <td>Likutis</td>
              {menesiai.map((m) => {
                const s = sumos.get(m.month)
                const likutis = (s?.pajamos ?? 0) + (s?.islaidos ?? 0)
                return (
                  <td key={m.month} className={likutis < 0 ? 'num neigiamas' : 'num income'}>
                    {eur(likutis)}
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>
      </div>
      )}

      {vaizdas !== 'laikas' && pasirinktas && (
        <>
          {!siauras && <h2>{menuoVardas(pasirinktas)}</h2>}
          {!siauras && (
            <p className="paaiskinimas">
              Išskleisk grupę, kad matytum kategorijas, o kategoriją — kad matytum operacijas.
              Kategoriją gali pakeisti čia pat.
            </p>
          )}
          <KategorijuMedis
            rows={medzioEilutes}
            categories={categories}
            onChangeCategory={keistiKategorija}
            onCreateRule={setRuleFor}
            onSplit={(row) => setSplitFor(operacijos.find((t) => String(t.id) === row.key) ?? null)}
            onUnsplit={atsauktiSkaidyma}
            onOffset={(row) => setOffsetFor(operacijos.find((t) => String(t.id) === row.key) ?? null)}
            onUnlinkOffset={atsieti}
            onOpenGroup={(id) => {
              const g = categories.find((c) => c.id === id)
              if (g) onOpenGroup(g)
            }}
          />
        </>
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

      {ruleFor && (
        <TaisyklesDialogas
          categories={categories}
          pradinisTekstas={ruleFor.counterpartyName ?? ''}
          pradineKategorija={ruleFor.categoryId}
          siulytiTaikytiEsamoms
          onClose={() => setRuleFor(null)}
          onSaved={async () => {
            setRuleFor(null)
            await Promise.all([load(), pasirinktas ? loadMenesi(pasirinktas) : Promise.resolve()])
          }}
        />
      )}
    </section>
  )
}
