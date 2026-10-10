import { useState } from 'react'
import { api, eur, menuoVardas, type Category, type Transaction } from './api'
import KategorijosSelect from './KategorijosSelect'

type Dalis = { categoryId: string; suma: string; data: string }

type Props = {
  transaction: Transaction
  categories: Category[]
  onClose: () => void
  onSaved: (zinute: string) => void
}

/** „12,50" arba „12.50" -> centai. */
function centai(tekstas: string): number {
  const svarus = tekstas.replace(/\s/g, '').replace(',', '.')
  const skaicius = Number(svarus)
  return Number.isFinite(skaicius) ? Math.round(skaicius * 100) : NaN
}

const DATA = /^\d{4}-\d{2}-\d{2}$/

export default function SkaidymoDialogas({ transaction, categories, onClose, onSaved }: Props) {
  const visaSuma = Math.abs(transaction.amount_cents)
  const zenklas = transaction.amount_cents < 0 ? -1 : 1
  const pradineData = transaction.booking_date
  const pradineKategorija = String(transaction.category_id ?? '')

  const [dalys, setDalys] = useState<Dalis[]>([
    { categoryId: pradineKategorija, suma: (visaSuma / 100).toFixed(2), data: pradineData },
    { categoryId: pradineKategorija, suma: '', data: pradineData },
  ])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const suvesta = dalys.reduce((s, d) => {
    const c = centai(d.suma)
    return s + (Number.isNaN(c) ? 0 : c)
  }, 0)
  const liko = visaSuma - suvesta
  const perkeliama = dalys.some((d) => d.data !== pradineData)
  const tikPerkelimas = dalys.length === 1

  function keisti(i: number, laukas: keyof Dalis, reiksme: string) {
    setError(null)
    setDalys((prev) => prev.map((d, j) => (i === j ? { ...d, [laukas]: reiksme } : d)))
  }

  async function save() {
    if (liko !== 0) {
      return setError(`Dalių suma turi sutapti su operacijos suma. Trūksta ${eur(liko)}.`)
    }
    if (dalys.some((d) => !d.categoryId)) {
      return setError('Kiekvienai daliai pasirink kategoriją.')
    }
    if (dalys.some((d) => !DATA.test(d.data))) {
      return setError('Kiekvienai daliai nurodyk datą.')
    }
    if (tikPerkelimas && !perkeliama) {
      return setError('Palikus vieną dalį, jai reikia nurodyti kitą datą — kitaip nėra ką keisti.')
    }

    setSaving(true)
    try {
      const result = await api.splitTransaction(
        transaction.id,
        dalys.map((d) => ({
          categoryId: Number(d.categoryId),
          amountCents: zenklas * centai(d.suma),
          bookingDate: d.data,
        }))
      )
      onSaved(
        tikPerkelimas
          ? `Operacija perkelta į ${dalys[0].data}.`
          : `Operacija suskaidyta į ${result.created} dalis${perkeliama ? ', dalis perkelta į kitą datą' : ''}.`
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nepavyko suskaidyti.')
      setSaving(false)
    }
  }

  return (
    <div className="modal-fonas" onClick={onClose}>
      <div className="modal platus" onClick={(e) => e.stopPropagation()}>
        <h3>Skaidyti ar perkelti operaciją</h3>
        <p className="paaiskinimas">
          {transaction.counterparty_name ?? '—'} · {transaction.booking_date} ·{' '}
          <strong>{eur(transaction.amount_cents)}</strong>
          <br />
          Kiekvienai daliai gali pasirinkti kategoriją ir datą. Pavyzdžiui, pavėluotai sumokėtų
          komunalinių dalį perkelk į ankstesnį mėnesį — statistika rodys, kuriam mėnesiui išlaida
          priklauso. Pradinė operacija su banko data liks istorijoje.
        </p>

        {dalys.map((dalis, i) => {
          const kitasMenuo = DATA.test(dalis.data) && dalis.data.slice(0, 7) !== pradineData.slice(0, 7)
          return (
            <div className="skaidymo-eilute" key={i}>
              <KategorijosSelect
                categories={categories}
                value={dalis.categoryId}
                onChange={(v) => keisti(i, 'categoryId', v)}
                tuscias="— kategorija —"
                pajamos={transaction.amount_cents > 0}
              />
              <input
                type="date"
                value={dalis.data}
                onChange={(e) => keisti(i, 'data', e.target.value)}
                title="Kuriai datai (mėnesiui) priskirti šią dalį"
                aria-label="Dalies data"
              />
              <input
                inputMode="decimal"
                placeholder="0,00"
                value={dalis.suma}
                onChange={(e) => keisti(i, 'suma', e.target.value)}
                aria-label="Dalies suma"
              />
              {dalys.length > 1 && (
                <button
                  className="ghost small"
                  onClick={() => setDalys((prev) => prev.filter((_, j) => j !== i))}
                >
                  pašalinti
                </button>
              )}
              {kitasMenuo && (
                <span className="skaidymo-perkelimas">
                  → bus skaičiuojama: <strong>{menuoVardas(dalis.data.slice(0, 7))}</strong>
                </span>
              )}
            </div>
          )
        })}

        <div className="skaidymo-apacia">
          <button
            className="ghost small"
            onClick={() => setDalys((prev) => [...prev, { categoryId: pradineKategorija, suma: '', data: pradineData }])}
          >
            + dar viena dalis
          </button>
          <span className={liko === 0 ? 'done-inline' : 'warn'}>
            {liko === 0 ? 'Sumos sutampa' : `Nepaskirstyta: ${eur(liko)}`}
          </span>
        </div>

        {error && <p className="error">{error}</p>}

        <div className="modal-mygtukai">
          <button className="ghost" onClick={onClose}>
            Atšaukti
          </button>
          <button onClick={save} disabled={saving || liko !== 0}>
            {saving ? 'Saugoma...' : tikPerkelimas ? 'Perkelti' : 'Suskaidyti'}
          </button>
        </div>
      </div>
    </div>
  )
}
