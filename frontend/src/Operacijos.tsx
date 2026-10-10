import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import {
  api,
  eur,
  groupedCategories,
  type Category,
  type Transaction,
  type TransactionList,
} from './api'
import { useNariai } from './darbai/nariai'
import KategorijosSelect from './KategorijosSelect'
import { operacijosDetales } from './operacijosDetales'
import ProjektoPriskyrimas from './ProjektoPriskyrimas'
import SkaidymoDialogas from './SkaidymoDialogas'
import SudengimoDialogas from './SudengimoDialogas'
import SudengimoIsklotine from './SudengimoIsklotine'
import TaisyklesDialogas from './TaisyklesDialogas'

type Props = { categories: Category[] }

export default function Operacijos({ categories }: Props) {
  const { nariai } = useNariai()
  const [data, setData] = useState<TransactionList | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [expanded, setExpanded] = useState<number | null>(null)
  const [ruleFor, setRuleFor] = useState<Transaction | null>(null)
  const [splitFor, setSplitFor] = useState<Transaction | null>(null)
  const [offsetFor, setOffsetFor] = useState<Transaction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [zinute, setZinute] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [search, setSearch] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [owner, setOwner] = useState('')
  const [onlyUncategorized, setOnlyUncategorized] = useState(false)
  const [includeTransfers, setIncludeTransfers] = useState(false)

  const grouped = useMemo(() => groupedCategories(categories), [categories])

  const load = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const params: Record<string, string> = { limit: '300' }
      if (search) params.search = search
      if (from) params.from = from
      if (to) params.to = to
      if (categoryId) params.categoryId = categoryId
      if (owner) params.owner = owner
      if (onlyUncategorized) params.uncategorized = '1'
      if (includeTransfers) params.includeTransfers = '1'
      setData(await api.transactions(params))
      setSelected(new Set())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nepavyko užkrauti operacijų.')
    } finally {
      setBusy(false)
    }
  }, [search, from, to, categoryId, owner, onlyUncategorized, includeTransfers])

  useEffect(() => {
    load()
  }, [load])

  async function changeCategory(ids: number[], value: string) {
    setBusy(true)
    try {
      if (value === 'transfer') {
        await api.updateTransactions({ ids, isTransfer: true })
      } else {
        await api.updateTransactions({ ids, categoryId: value === '' ? null : Number(value) })
      }
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nepavyko pakeisti kategorijos.')
      setBusy(false)
    }
  }

  async function atsieti(incomeId: number) {
    if (!confirm('Atsieti sudengimą? Įplauka vėl bus rodoma kaip nepriskirta įplauka.')) return
    try {
      await api.unlinkOffset(incomeId)
      setZinute('Sudengimas atsietas.')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nepavyko atsieti sudengimo.')
    }
  }

  async function atsauktiSkaidyma(parentId: number) {
    if (!confirm('Atšaukti skaidymą? Visos dalys bus sujungtos atgal į vieną operaciją be kategorijos.')) return
    try {
      await api.unsplitTransaction(parentId)
      setZinute('Skaidymas atšauktas.')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nepavyko atšaukti skaidymo.')
    }
  }

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const rows = data?.rows ?? []
  const allSelected = rows.length > 0 && selected.size === rows.length

  return (
    <section>
      <div className="filters">
        <input
          type="search"
          placeholder="Ieškoti gavėjo ar paskirties"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label>
          Nuo <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          Iki <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          disabled={onlyUncategorized}
        >
          <option value="">Visos kategorijos</option>
          {grouped.map(({ group, children }) => (
            <optgroup key={group.id} label={group.name}>
              {children.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <select value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Iš kieno sąskaitos">
          <option value="">Visos sąskaitos</option>
          {nariai
            .filter((n) => n.uses_app)
            .map((n) => (
              <option key={n.id} value={n.name}>
                {n.name}: sąskaitos
              </option>
            ))}
        </select>
        <label className="check">
          <input
            type="checkbox"
            checked={onlyUncategorized}
            onChange={(e) => setOnlyUncategorized(e.target.checked)}
          />
          Tik nepriskirtos
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={includeTransfers}
            onChange={(e) => setIncludeTransfers(e.target.checked)}
          />
          Rodyti pervedimus
        </label>
      </div>

      {error && <p className="error">{error}</p>}
      {zinute && <p className="done">{zinute}</p>}

      {data && (
        <ul className="summary">
          <li>
            Operacijų: <strong>{data.totals.count}</strong>
          </li>
          <li>
            Pajamos: <strong className="income">{eur(data.totals.income)}</strong>
          </li>
          <li>
            Išlaidos: <strong>{eur(data.totals.expense)}</strong>
          </li>
          <li>
            Skirtumas: <strong>{eur(data.totals.income + data.totals.expense)}</strong>
          </li>
        </ul>
      )}

      {selected.size > 0 && (
        <div className="bulk">
          <span>Pažymėta: {selected.size}</span>
          <KategorijosSelect
            categories={categories}
            onChange={(v) => changeCategory([...selected], v)}
            tuscias="Priskirti kategoriją..."
            tusciasIsjungtas
            suPervedimu
          />
          <button className="ghost" onClick={() => setSelected(new Set())}>
            Atžymėti
          </button>
        </div>
      )}

      <div className="table-wrap">
        <table className="korteles">
          <thead>
            <tr>
              <th className="tight pazymejimas">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
                />
              </th>
              <th>Data</th>
              <th>Gavėjas</th>
              <th className="num">Suma</th>
              <th>Kategorija</th>
              <th className="tight"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Fragment key={row.id}>
                <tr className={selected.has(row.id) ? 'picked' : undefined}>
                  <td className="tight pazymejimas">
                    <input
                      type="checkbox"
                      checked={selected.has(row.id)}
                      onChange={() => toggle(row.id)}
                    />
                  </td>
                  <td className="nowrap">{row.booking_date}</td>
                  <td>
                    <button
                      className="linkish"
                      onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                    >
                      {row.counterparty_name ?? row.description?.slice(0, 45) ?? '—'}
                    </button>
                    {row.parent_id !== null && (
                      <span className="tag">
                        {row.parent_booking_date && row.parent_booking_date !== row.booking_date
                          ? `dalis, perkelta iš ${row.parent_booking_date}`
                          : 'skaidymo dalis'}
                      </span>
                    )}
                    {row.offsets.length > 0 && <span className="tag sudengta">sudengta</span>}
                    {row.offset_of_id !== null && (
                      <span className="tag sudengta">
                        dengia: {row.offset_target_name ?? '—'} · {row.offset_target_date}
                        {row.offset_target_amount !== null && ` · ${eur(row.offset_target_amount)}`}
                      </span>
                    )}
                  </td>
                  <td
                    className={
                      row.offset_of_id !== null
                        ? 'num sudengimo-suma'
                        : row.amount_cents < 0
                          ? 'num'
                          : 'num income'
                    }
                  >
                    {eur(row.amount_cents + row.offset_cents)}
                    {row.offset_cents !== 0 && (
                      <span className="is-pradines">iš {eur(row.amount_cents)}</span>
                    )}
                  </td>
                  <td>
                    {row.offset_of_id !== null ? (
                      <span className="paaiskinimas">sudengimas</span>
                    ) : (
                    <KategorijosSelect
                      categories={categories}
                      value={row.is_transfer ? 'transfer' : String(row.category_id ?? '')}
                      onChange={(v) => changeCategory([row.id], v)}
                      className={!row.category_id && !row.is_transfer ? 'unset' : undefined}
                      tuscias="— nepriskirta —"
                      suPervedimu
                      pajamos={row.amount_cents > 0}
                    />
                    )}
                  </td>
                  <td className="tight">
                    <button className="ghost small" onClick={() => setRuleFor(row)}>
                      Taisyklė
                    </button>
                    {row.offset_of_id !== null ? (
                      <button className="ghost small" onClick={() => atsieti(row.id)}>
                        Atsieti
                      </button>
                    ) : (
                      <button className="ghost small" onClick={() => setOffsetFor(row)}>
                        Sudengti
                      </button>
                    )}
                    {row.offset_of_id === null &&
                      row.offsets.length === 0 &&
                      (row.parent_id === null ? (
                        <button className="ghost small" onClick={() => setSplitFor(row)}>
                          Skaidyti
                        </button>
                      ) : (
                        <button className="ghost small" onClick={() => atsauktiSkaidyma(row.parent_id!)}>
                          Atšaukti skaidymą
                        </button>
                      ))}
                  </td>
                </tr>

                {expanded === row.id && (
                  <tr className="detail">
                    <td colSpan={6}>
                      <dl>
                        {operacijosDetales(row).map((d) => (
                          <Fragment key={d.etikete}>
                            <dt>{d.etikete}</dt>
                            <dd>{d.reiksme}</dd>
                          </Fragment>
                        ))}
                      </dl>
                      {row.offsets.length > 0 && (
                        <SudengimoIsklotine
                          amountCents={row.amount_cents}
                          offsets={row.offsets}
                          onUnlink={atsieti}
                        />
                      )}
                      <ProjektoPriskyrimas operacija={row} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length === 0 && !busy && <p className="tuscia">Operacijų nerasta.</p>}

      {offsetFor && (
        <SudengimoDialogas
          transaction={offsetFor}
          onClose={() => setOffsetFor(null)}
          onSaved={async (message) => {
            setOffsetFor(null)
            setError(null)
            setZinute(message)
            await load()
          }}
        />
      )}

      {splitFor && (
        <SkaidymoDialogas
          transaction={splitFor}
          categories={categories}
          onClose={() => setSplitFor(null)}
          onSaved={async (message) => {
            setSplitFor(null)
            setZinute(message)
            await load()
          }}
        />
      )}

      {ruleFor && (
        <TaisyklesDialogas
          categories={categories}
          pradinisTekstas={ruleFor.counterparty_name ?? ''}
          pradineKategorija={ruleFor.category_id}
          siulytiTaikytiEsamoms
          onClose={() => setRuleFor(null)}
          onSaved={async ({ pritaikyta }) => {
            setRuleFor(null)
            setError(null)
            setZinute(`Taisyklė sukurta. Pritaikyta operacijų: ${pritaikyta}.`)
            await load()
          }}
        />
      )}
    </section>
  )
}
