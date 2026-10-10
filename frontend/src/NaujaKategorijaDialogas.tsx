import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, type Category } from './api'
import { usePridetiKategorija } from './KategorijuKontekstas'

type Props = {
  categories: Category[]
  /** Kurią grupę pasiūlyti iš karto (pvz. dabartinės kategorijos grupę). */
  numatytojiGrupe: number | null
  onClose: () => void
  onCreated: (category: Category) => void
}

/**
 * Atidaromas virš bet kurio kito lango (ir virš skaidymo dialogo), todėl
 * piešiamas tiesiai į body.
 */
export default function NaujaKategorijaDialogas({ categories, numatytojiGrupe, onClose, onCreated }: Props) {
  const pridetiKategorija = usePridetiKategorija()
  const grupes = useMemo(
    () => categories.filter((c) => c.parent_id === null && c.type !== 'transfer'),
    [categories]
  )

  const [pavadinimas, setPavadinimas] = useState('')
  const [grupeId, setGrupeId] = useState(numatytojiGrupe !== null ? String(numatytojiGrupe) : '')
  const [poskyris, setPoskyris] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const grupe = grupes.find((g) => String(g.id) === grupeId)
  const esamos = grupe ? categories.filter((c) => c.parent_id === grupe.id).map((c) => c.name) : []
  // Grupės poskyriai (pvz., Emos „Būreliai“) — nauja kategorija gali iškart į jį patekti.
  const poskyriai = grupe
    ? [...new Set(categories.filter((c) => c.parent_id === grupe.id && c.subgroup).map((c) => c.subgroup as string))]
    : []

  async function save() {
    if (!pavadinimas.trim()) return setError('Įrašyk kategorijos pavadinimą.')
    if (!grupeId) return setError('Pasirink grupę, kuriai priklausys kategorija.')

    setSaving(true)
    setError(null)
    try {
      const sukurta = await api.createCategory({
        name: pavadinimas.trim(),
        parentId: Number(grupeId),
        subgroup: poskyriai.includes(poskyris) ? poskyris : null,
      })
      pridetiKategorija(sukurta)
      onCreated(sukurta)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nepavyko sukurti kategorijos.')
      setSaving(false)
    }
  }

  return createPortal(
    <div
      className="modal-fonas"
      onClick={(e) => {
        e.stopPropagation()
        onClose()
      }}
    >
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Nauja kategorija</h3>
        <p className="paaiskinimas">
          Sukurta kategorija iškart bus pasirinkta ir atsiras visuose kategorijų sąrašuose.
        </p>

        <label>
          Pavadinimas
          <input
            autoFocus
            value={pavadinimas}
            placeholder="pvz. Prenumeratos"
            onChange={(e) => setPavadinimas(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save()
              if (e.key === 'Escape') onClose()
            }}
          />
        </label>

        <label>
          Grupė
          <select
            value={grupeId}
            onChange={(e) => {
              setGrupeId(e.target.value)
              setPoskyris('')
            }}
          >
            <option value="" disabled>
              — pasirink grupę —
            </option>
            {grupes.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
                {g.type === 'income' ? ' (pajamos)' : ''}
              </option>
            ))}
          </select>
        </label>

        {poskyriai.length > 0 && (
          <label>
            Poskyris
            <select value={poskyris} onChange={(e) => setPoskyris(e.target.value)}>
              <option value="">— nėra —</option>
              {poskyriai.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        )}

        {esamos.length > 0 && (
          <p className="paaiskinimas">Šioje grupėje jau yra: {esamos.join(', ')}.</p>
        )}

        {error && <p className="error">{error}</p>}

        <div className="modal-mygtukai">
          <button className="ghost" onClick={onClose}>
            Atšaukti
          </button>
          <button onClick={save} disabled={saving}>
            {saving ? 'Kuriama...' : 'Sukurti kategoriją'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
