import { useState } from 'react'
import { api, type Category } from './api'
import KategorijosSelect from './KategorijosSelect'

type Props = {
  categories: Category[]
  pradinisTekstas: string
  pradineKategorija: number | null
  /** Kai importo peržiūroje — taisyklė galioja tik dar neišsaugotoms eilutėms. */
  siulytiTaikytiEsamoms: boolean
  onClose: () => void
  onSaved: (info: { tekstas: string; categoryId: number; pritaikyta: number }) => void
}

export default function TaisyklesDialogas({
  categories,
  pradinisTekstas,
  pradineKategorija,
  siulytiTaikytiEsamoms,
  onClose,
  onSaved,
}: Props) {
  const [tekstas, setTekstas] = useState(pradinisTekstas)
  const [categoryId, setCategoryId] = useState(String(pradineKategorija ?? ''))
  const [taikytiEsamoms, setTaikytiEsamoms] = useState(siulytiTaikytiEsamoms)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (!tekstas.trim()) return setError('Įrašyk tekstą, pagal kurį atpažinti.')
    if (!categoryId) return setError('Pasirink kategoriją.')

    setSaving(true)
    try {
      const result = await api.createRule({
        field: 'any',
        operator: 'contains',
        value: tekstas.trim(),
        categoryId: Number(categoryId),
        applyToExisting: taikytiEsamoms,
        note: 'Sukurta iš appso',
      })
      onSaved({
        tekstas: tekstas.trim(),
        categoryId: Number(categoryId),
        pritaikyta: result.applied,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nepavyko sukurti taisyklės.')
      setSaving(false)
    }
  }

  return (
    <div className="modal-fonas" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Nauja taisyklė</h3>
        <p className="paaiskinimas">
          Kai gavėjo pavadinime arba mokėjimo paskirtyje bus šis tekstas, operacija automatiškai
          gaus pasirinktą kategoriją — ir dabar, ir kituose išrašuose.
        </p>

        <label>
          Tekstas, pagal kurį atpažinti
          <input value={tekstas} onChange={(e) => setTekstas(e.target.value)} />
        </label>

        <label>
          Kategorija
          <KategorijosSelect
            categories={categories}
            value={categoryId}
            onChange={setCategoryId}
            tuscias="— pasirink —"
          />
        </label>

        <label className="check">
          <input
            type="checkbox"
            checked={taikytiEsamoms}
            onChange={(e) => setTaikytiEsamoms(e.target.checked)}
          />
          Pritaikyti ir anksčiau importuotoms nepriskirtoms operacijoms
        </label>

        {error && <p className="error">{error}</p>}

        <div className="modal-mygtukai">
          <button className="ghost" onClick={onClose}>
            Atšaukti
          </button>
          <button onClick={save} disabled={saving}>
            {saving ? 'Saugoma...' : 'Sukurti taisyklę'}
          </button>
        </div>
      </div>
    </div>
  )
}
