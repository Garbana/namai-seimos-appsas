import { useMemo, useState } from 'react'
import { groupedCategories, type Category } from './api'
import NaujaKategorijaDialogas from './NaujaKategorijaDialogas'

const NAUJA = '__nauja__'

type Props = {
  categories: Category[]
  /**
   * Pasirinkta reikšmė: '' | 'transfer' | kategorijos id. Nenurodžius — tai
   * veiksmo pasirinkimas (pvz. „Priskirti kategoriją..."), kuris po pasirinkimo
   * grįžta į pradinę būseną.
   */
  value?: string
  onChange: (value: string) => void
  /** Pirmas punktas, pvz. „— nepriskirta —". */
  tuscias: string
  tusciasIsjungtas?: boolean
  suPervedimu?: boolean
  /** Naujai kategorijai pagal nutylėjimą siūlyti pajamų grupę. */
  pajamos?: boolean
  className?: string
  ariaLabel?: string
}

/** Kategorijos pasirinkimas su galimybe čia pat susikurti naują kategoriją. */
export default function KategorijosSelect({
  categories,
  value,
  onChange,
  tuscias,
  tusciasIsjungtas,
  suPervedimu,
  pajamos,
  className,
  ariaLabel,
}: Props) {
  const [kuriama, setKuriama] = useState(false)
  const grouped = useMemo(() => groupedCategories(categories), [categories])

  const numatytojiGrupe = useMemo(() => {
    const dabartine = value ? categories.find((c) => String(c.id) === value) : undefined
    if (dabartine) return dabartine.parent_id ?? dabartine.id
    if (pajamos) return categories.find((c) => c.parent_id === null && c.type === 'income')?.id ?? null
    return null
  }, [value, categories, pajamos])

  return (
    <>
      <select
        value={value ?? ''}
        className={className}
        aria-label={ariaLabel}
        onChange={(e) => {
          if (e.target.value === NAUJA) {
            setKuriama(true)
            return
          }
          onChange(e.target.value)
        }}
      >
        <option value="" disabled={tusciasIsjungtas}>
          {tuscias}
        </option>
        <option value={NAUJA}>+ Nauja kategorija…</option>
        {suPervedimu && <option value="transfer">Vidinis pervedimas</option>}
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

      {kuriama && (
        <NaujaKategorijaDialogas
          categories={categories}
          numatytojiGrupe={numatytojiGrupe}
          onClose={() => setKuriama(false)}
          onCreated={(sukurta) => {
            setKuriama(false)
            onChange(String(sukurta.id))
          }}
        />
      )}
    </>
  )
}
