import { useMemo, useState } from 'react'
import { eur, type Category, type Sudengimas } from './api'
import KategorijosSelect from './KategorijosSelect'
import SudengimoIsklotine from './SudengimoIsklotine'

export type MedzioEilute = {
  key: string
  bookingDate: string
  counterpartyName: string | null
  description: string | null
  amountCents: number
  categoryId: number | null
  isTransfer: boolean
  /** Dublikatai ir praleistos operacijos į sumas neįskaičiuojamos. */
  ignored: boolean
  /** Eilutė yra suskaidytos operacijos dalis. */
  isSplitPart?: boolean
  /** Jei skaidymo dalis perkelta į kitą datą — pradinė banko data. */
  movedFrom?: string | null
  /** Išlaidą dengiančių įplaukų suma ir sąrašas. Sumose rodoma likusi dalis. */
  offsetCents?: number
  offsets?: Sudengimas[]
  /** Banko išrašo duomenys, rodomi išskleidus operaciją. */
  detales?: { etikete: string; reiksme: string | null }[]
}

type Props = {
  rows: MedzioEilute[]
  categories: Category[]
  onChangeCategory: (keys: string[], value: number | null | 'transfer') => void
  onSkip?: (key: string) => void
  onCreateRule?: (row: MedzioEilute) => void
  /** Jei nurodyta, prie grupės atsiranda nuoroda į jos istoriją per mėnesius. */
  onOpenGroup?: (groupId: number) => void
  /** Jei nurodyta, prie jau išsaugotų operacijų atsiranda skaidymas. */
  onSplit?: (row: MedzioEilute) => void
  onUnsplit?: (row: MedzioEilute) => void
  onOffset?: (row: MedzioEilute) => void
  onUnlinkOffset?: (incomeId: number) => void
}

const BE_KATEGORIJOS = -1
const PERVEDIMAI = -2
const BE_KATEGORIJOS_IPLAUKOS = -3

/** Suma po sudengimų — būtent ji skaičiuojama į kategorijų ir grupių sumas. */
const neto = (row: MedzioEilute) => row.amountCents + (row.offsetCents ?? 0)

export default function KategorijuMedis({
  rows,
  categories,
  onChangeCategory,
  onSkip,
  onCreateRule,
  onOpenGroup,
  onSplit,
  onUnsplit,
  onOffset,
  onUnlinkOffset,
}: Props) {
  const [openGroups, setOpenGroups] = useState<Set<number>>(new Set([BE_KATEGORIJOS, BE_KATEGORIJOS_IPLAUKOS]))
  const [openCats, setOpenCats] = useState<Set<number>>(new Set())
  const [moveFrom, setMoveFrom] = useState<number | null>(null)
  const [isskleista, setIsskleista] = useState<string | null>(null)
  const [pasiulymas, setPasiulymas] = useState<{
    gavejas: string
    value: number | null | 'transfer'
    kiti: string[]
  } | null>(null)

  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])

  const tree = useMemo(() => {
    const active = rows.filter((r) => !r.ignored)

    const groups = new Map<
      number,
      { id: number; name: string; sum: number; count: number; cats: Map<number, { id: number; name: string; sum: number; rows: MedzioEilute[] }> }
    >()

    const ensureGroup = (id: number, name: string) => {
      if (!groups.has(id)) groups.set(id, { id, name, sum: 0, count: 0, cats: new Map() })
      return groups.get(id)!
    }

    for (const row of active) {
      let groupId: number
      let groupName: string
      let catId: number
      let catName: string

      if (row.isTransfer) {
        groupId = PERVEDIMAI
        groupName = 'Vidiniai pervedimai'
        catId = PERVEDIMAI
        catName = 'Pervedimai tarp savo sąskaitų'
      } else if (row.categoryId === null) {
        // Nepriskirtos įplaukos atskirai — kitaip jos slėptųsi tarp išlaidų
        // ir mažintų jų sumą, nors su išlaidomis neturi nieko bendra.
        const iplauka = row.amountCents > 0
        groupId = iplauka ? BE_KATEGORIJOS_IPLAUKOS : BE_KATEGORIJOS
        groupName = iplauka ? 'Be kategorijos (įplaukos)' : 'Be kategorijos'
        catId = groupId
        catName = 'Reikia priskirti'
      } else {
        const category = byId.get(row.categoryId)
        const parent = category?.parent_id ? byId.get(category.parent_id) : null
        groupId = parent?.id ?? category?.id ?? BE_KATEGORIJOS
        groupName = parent?.name ?? category?.name ?? 'Be kategorijos'
        catId = row.categoryId
        catName = category?.name ?? '—'
      }

      const group = ensureGroup(groupId, groupName)
      group.sum += neto(row)
      group.count++

      if (!group.cats.has(catId)) group.cats.set(catId, { id: catId, name: catName, sum: 0, rows: [] })
      const cat = group.cats.get(catId)!
      cat.sum += neto(row)
      cat.rows.push(row)
    }

    // Apžvalgoje (kai yra nuoroda į istoriją) rodomos ir tą mėnesį tuščios išlaidų grupės,
    // kitaip į jų ekraną (pvz. „Draudimas", kol mėnesio įmokos dar nenurašytos) nepatektum.
    if (onOpenGroup) {
      for (const category of categories) {
        if (category.parent_id === null && category.type === 'expense') ensureGroup(category.id, category.name)
      }
    }

    const order = (id: number) => {
      if (id === BE_KATEGORIJOS) return -1000
      if (id === BE_KATEGORIJOS_IPLAUKOS) return -999
      if (id === PERVEDIMAI) return 1000
      return byId.get(id)?.sort_order ?? 0
    }

    return [...groups.values()]
      .sort((a, b) => order(a.id) - order(b.id))
      .map((g) => ({
        ...g,
        cats: [...g.cats.values()].sort((a, b) => Math.abs(b.sum) - Math.abs(a.sum)),
      }))
  }, [rows, byId, categories, onOpenGroup])

  /**
   * Pusė nustatoma pagal kategorijos grupę, o ne pagal sumos ženklą: grąžinimas
   * parduotuvėje turi mažinti tos kategorijos išlaidas, o ne virsti pajamomis.
   * Nepriskirtos operacijos skirstomos pagal ženklą, nes grupės dar neturi.
   */
  const totals = useMemo(() => {
    let islaidos = 0
    let pajamos = 0

    for (const row of rows) {
      if (row.ignored || row.isTransfer) continue

      const category = row.categoryId !== null ? byId.get(row.categoryId) : undefined
      const group = category?.parent_id ? byId.get(category.parent_id) : category
      const iplauka = group ? group.type === 'income' : row.amountCents > 0

      if (iplauka) pajamos += neto(row)
      else islaidos += neto(row)
    }

    return { islaidos, pajamos }
  }, [rows, byId])

  const islaiduBaze = Math.abs(totals.islaidos)

  /**
   * Pakeitus vieną operaciją, pasiūlom tą patį ir kitoms to paties gavėjo
   * operacijoms — bet tik pasiūlom. Kartais viena to paties gavėjo operacija
   * tikrai priklauso kitai kategorijai.
   */
  function keistiViena(row: MedzioEilute, value: number | null | 'transfer') {
    onChangeCategory([row.key], value)

    const gavejas = row.counterpartyName?.trim()
    if (!gavejas) return setPasiulymas(null)

    const kiti = rows
      .filter(
        (r) =>
          !r.ignored &&
          r.key !== row.key &&
          r.counterpartyName?.trim() === gavejas &&
          !sutampa(r, value)
      )
      .map((r) => r.key)

    setPasiulymas(kiti.length > 0 ? { gavejas, value, kiti } : null)
  }

  function sutampa(row: MedzioEilute, value: number | null | 'transfer') {
    return value === 'transfer' ? row.isTransfer : row.categoryId === value
  }

  function toggle(set: Set<number>, id: number, update: (s: Set<number>) => void) {
    const next = new Set(set)
    next.has(id) ? next.delete(id) : next.add(id)
    update(next)
  }

  return (
    <div className="medis">
      <div className="medis-sumos">
        <div>
          <span>Išlaidos</span>
          <strong>{eur(totals.islaidos)}</strong>
        </div>
        <div>
          <span>Pajamos</span>
          <strong className="income">{eur(totals.pajamos)}</strong>
        </div>
        <div>
          <span>Skirtumas</span>
          <strong>{eur(totals.pajamos + totals.islaidos)}</strong>
        </div>
      </div>

      {pasiulymas && (
        <div className="pasiulymas">
          <span>
            Yra dar <strong>{pasiulymas.kiti.length}</strong>{' '}
            {pasiulymas.kiti.length === 1 ? 'operacija' : 'operacijos'} su gavėju „
            {pasiulymas.gavejas}". Priskirti ir joms tą pačią kategoriją?
          </span>
          <button
            onClick={() => {
              onChangeCategory(pasiulymas.kiti, pasiulymas.value)
              setPasiulymas(null)
            }}
          >
            Taip, visoms
          </button>
          <button className="ghost" onClick={() => setPasiulymas(null)}>
            Ne, tik šią
          </button>
        </div>
      )}

      {tree.map((group) => {
        const atidaryta = openGroups.has(group.id)
        // Pervedimai neįeina į išlaidų sumą, tad ir jų dalies skaičiuoti negalima.
        const dalis =
          islaiduBaze > 0 && group.sum < 0 && group.id !== PERVEDIMAI
            ? Math.abs(group.sum) / islaiduBaze
            : 0

        return (
          <div
            key={group.id}
            className={`grupe ${
              group.id === BE_KATEGORIJOS || group.id === BE_KATEGORIJOS_IPLAUKOS ? 'trukumas' : ''
            }`}
          >
            <div className="grupe-virsus">
            <button
              className="grupe-antraste"
              onClick={() => toggle(openGroups, group.id, setOpenGroups)}
            >
              <span className={atidaryta ? 'rodykle atidaryta' : 'rodykle'}>▶</span>
              <span className="grupe-vardas">{group.name}</span>
              <span className="grupe-kiekis">
                {group.count === 0 ? 'šį mėnesį operacijų nėra' : `${group.count} oper. · ${group.cats.length} kateg.`}
              </span>
              {dalis > 0 && <span className="grupe-dalis">{Math.round(dalis * 100)}%</span>}
              <span className={group.sum > 0 ? 'grupe-suma income' : 'grupe-suma'}>
                {eur(group.sum)}
              </span>
            </button>

            {onOpenGroup && group.id > 0 && (
              <button
                className="grupes-istorija"
                onClick={() => onOpenGroup(group.id)}
                title="Šios grupės istorija per mėnesius"
              >
                istorija →
              </button>
            )}
            </div>

            {atidaryta &&
              group.cats.map((cat) => {
                const catOpen = openCats.has(cat.id)
                const catDalis = group.sum !== 0 ? Math.abs(cat.sum / group.sum) : 0

                return (
                  <div key={cat.id} className="kategorija">
                    <div className="kategorija-antraste">
                      <button
                        className="kategorija-vardas"
                        onClick={() => toggle(openCats, cat.id, setOpenCats)}
                      >
                        <span className={catOpen ? 'rodykle atidaryta' : 'rodykle'}>▶</span>
                        {cat.name}
                      </button>
                      <div className="juosta">
                        <div style={{ width: `${Math.min(catDalis * 100, 100)}%` }} />
                      </div>
                      <span className="kategorija-kiekis">{cat.rows.length} oper.</span>
                      <span className={cat.sum > 0 ? 'kategorija-suma income' : 'kategorija-suma'}>
                        {eur(cat.sum)}
                      </span>
                      <button
                        className="ghost small"
                        onClick={() => setMoveFrom(moveFrom === cat.id ? null : cat.id)}
                        title="Perkelti visas šios kategorijos operacijas kitur"
                      >
                        perkelti visas
                      </button>
                    </div>

                    {moveFrom === cat.id && (
                      <div className="perkelimas">
                        <span>Visas {cat.rows.length} oper. perkelti į:</span>
                        <KategorijosSelect
                          categories={categories}
                          onChange={(value) => {
                            if (!value) return
                            onChangeCategory(
                              cat.rows.map((r) => r.key),
                              value === 'transfer' ? 'transfer' : Number(value)
                            )
                            setMoveFrom(null)
                          }}
                          tuscias="— pasirink —"
                          tusciasIsjungtas
                          suPervedimu
                          pajamos={cat.sum > 0}
                        />
                        <button className="ghost small" onClick={() => setMoveFrom(null)}>
                          atšaukti
                        </button>
                      </div>
                    )}

                    {catOpen && (
                      <div className="operacijos">
                        {cat.rows
                          .slice()
                          .sort((a, b) => a.bookingDate.localeCompare(b.bookingDate))
                          .map((row) => (
                            <div key={row.key} className="operacija">
                              <span className="op-data">{row.bookingDate}</span>
                              <button
                                className="op-gavejas linkish"
                                onClick={() =>
                                  setIsskleista(isskleista === row.key ? null : row.key)
                                }
                                title="Rodyti banko išrašo duomenis"
                              >
                                {row.counterpartyName ?? row.description?.slice(0, 40) ?? '—'}
                              {row.isSplitPart && (
                                <span className="tag">
                                  {row.movedFrom ? `dalis, perkelta iš ${row.movedFrom}` : 'skaidymo dalis'}
                                </span>
                              )}
                              {!!row.offsets?.length && <span className="tag sudengta">sudengta</span>}
                              </button>
                              <span className={row.amountCents > 0 ? 'op-suma income' : 'op-suma'}>
                                {eur(neto(row))}
                                {!!row.offsetCents && (
                                  <span className="is-pradines">iš {eur(row.amountCents)}</span>
                                )}
                              </span>
                              <KategorijosSelect
                                categories={categories}
                                value={row.isTransfer ? 'transfer' : String(row.categoryId ?? '')}
                                onChange={(v) =>
                                  keistiViena(row, v === 'transfer' ? 'transfer' : v === '' ? null : Number(v))
                                }
                                tuscias="— nepriskirta —"
                                suPervedimu
                                pajamos={row.amountCents > 0}
                              />
                              {onCreateRule && (
                                <button className="ghost small" onClick={() => onCreateRule(row)}>
                                  taisyklė
                                </button>
                              )}
                              {onSplit && !row.isSplitPart && !row.offsets?.length && (
                                <button
                                  className="ghost small"
                                  onClick={() => onSplit(row)}
                                  title="Padalyti operaciją į kelias kategorijas"
                                >
                                  skaidyti
                                </button>
                              )}
                              {onUnsplit && row.isSplitPart && (
                                <button
                                  className="ghost small"
                                  onClick={() => onUnsplit(row)}
                                  title="Sujungti dalis atgal į vieną operaciją"
                                >
                                  atšaukti skaidymą
                                </button>
                              )}
                              {onOffset && !row.isTransfer && (
                                <button
                                  className="ghost small"
                                  onClick={() => onOffset(row)}
                                  title={
                                    row.amountCents < 0
                                      ? 'Pridėti įplaukas, kurios dengia šią išlaidą'
                                      : 'Susieti šią įplauką su išlaida, kurią ji dengia'
                                  }
                                >
                                  {row.amountCents < 0 ? 'sudengti' : 'sudengti su išlaida'}
                                </button>
                              )}
                              {onSkip && (
                                <button
                                  className="ghost small"
                                  onClick={() => onSkip(row.key)}
                                  title="Neimportuoti šios operacijos"
                                >
                                  praleisti
                                </button>
                              )}

                              {isskleista === row.key && !!row.offsets?.length && (
                                <SudengimoIsklotine
                                  amountCents={row.amountCents}
                                  offsets={row.offsets}
                                  onUnlink={onUnlinkOffset}
                                />
                              )}
                              {isskleista === row.key && row.detales && (
                                <dl className="op-detales">
                                  {row.detales.map((d) => (
                                    <div key={d.etikete}>
                                      <dt>{d.etikete}</dt>
                                      <dd>{d.reiksme ?? '—'}</dd>
                                    </div>
                                  ))}
                                </dl>
                              )}
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                )
              })}
          </div>
        )
      })}
    </div>
  )
}
