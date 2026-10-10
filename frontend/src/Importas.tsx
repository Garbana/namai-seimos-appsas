import { useMemo, useRef, useState } from 'react'
import { type Category } from './api'
import { useNariai } from './darbai/nariai'
import KategorijuMedis, { type MedzioEilute } from './KategorijuMedis'
import TaisyklesDialogas from './TaisyklesDialogas'

type PreviewRow = {
  bookingDate: string
  valueDate: string | null
  amountCents: number
  currency: string
  counterpartyName: string | null
  counterpartyAccount: string | null
  description: string | null
  reference: string | null
  rawType: string | null
  country: string | null
  accountIban: string
  categoryId: number | null
  isTransfer: boolean
  isDuplicate: boolean
  fingerprint: string
}

type Preview = {
  bank: string
  owner: string
  rows: PreviewRow[]
  skipped: { reason: string; count: number }[]
}

type Props = { categories: Category[]; onImported: () => void }

export default function Importas({ categories, onImported }: Props) {
  const { nariai, as } = useNariai()
  // Sąskaitų savininkai — appsu besinaudojantys šeimos nariai.
  const savininkai = nariai.filter((n) => n.uses_app)
  const [pasirinktas, setOwner] = useState<string | null>(null)
  const owner = pasirinktas ?? nariai.find((n) => n.id === as)?.name ?? savininkai[0]?.name ?? ''
  const [preview, setPreview] = useState<Preview | null>(null)
  const [rows, setRows] = useState<PreviewRow[]>([])
  const [praleistos, setPraleistos] = useState<Set<string>>(new Set())
  const [taisykleiEilute, setTaisykleiEilute] = useState<MedzioEilute | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  /** Raktas eilutei — fingerprint unikalus kiekvienai operacijai. */
  const medzioEilutes: MedzioEilute[] = useMemo(
    () =>
      rows.map((row) => ({
        key: row.fingerprint,
        bookingDate: row.bookingDate,
        counterpartyName: row.counterpartyName,
        description: row.description,
        amountCents: row.amountCents,
        categoryId: row.categoryId,
        isTransfer: row.isTransfer,
        ignored: row.isDuplicate || praleistos.has(row.fingerprint),
        detales: [
          { etikete: 'Mokėjimo paskirtis', reiksme: row.description },
          { etikete: 'Gavėjo sąskaita', reiksme: row.counterpartyAccount },
          {
            etikete: 'Iš sąskaitos',
            reiksme: `${preview?.owner ?? ''} · ···${row.accountIban.slice(-4)}`,
          },
          { etikete: 'Data banke / dokumento data', reiksme: `${row.bookingDate} / ${row.valueDate ?? '—'}` },
          { etikete: 'Šalis', reiksme: row.country },
          { etikete: 'Operacijos tipas', reiksme: row.rawType },
          { etikete: 'Banko operacijos nr.', reiksme: row.reference },
        ],
      })),
    [rows, praleistos, preview]
  )

  const santrauka = useMemo(() => {
    const naujos = rows.filter((r) => !r.isDuplicate && !praleistos.has(r.fingerprint))
    return {
      viso: rows.length,
      dublikatai: rows.filter((r) => r.isDuplicate).length,
      praleistos: praleistos.size,
      importuosim: naujos.length,
      beKategorijos: naujos.filter((r) => r.categoryId === null && !r.isTransfer).length,
    }
  }, [rows, praleistos])

  async function handlePreview(event: React.FormEvent) {
    event.preventDefault()
    const file = fileInput.current?.files?.[0]
    if (!file) return setError('Pasirink CSV failą.')

    setBusy(true)
    setError(null)
    setDone(null)
    setPreview(null)
    setRows([])
    setPraleistos(new Set())

    const body = new FormData()
    body.append('file', file)
    body.append('owner', owner)

    try {
      const res = await fetch('/api/import/preview', { method: 'POST', body })
      const data = await res.json()
      if (!res.ok) throw new Error(data.klaida ?? 'Nepavyko perskaityti failo.')
      setPreview(data)
      setRows(data.rows)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nepavyko perskaityti failo.')
    } finally {
      setBusy(false)
    }
  }

  function keistiKategorija(keys: string[], value: number | null | 'transfer') {
    const rinkinys = new Set(keys)
    setRows((prev) =>
      prev.map((row) =>
        rinkinys.has(row.fingerprint)
          ? {
              ...row,
              categoryId: value === 'transfer' ? null : value,
              isTransfer: value === 'transfer',
            }
          : row
      )
    )
  }

  /** Ką tik sukurta taisyklė iškart pritaikoma dar neišsaugotoms eilutėms. */
  function pritaikytiTaisykle(tekstas: string, categoryId: number) {
    const ieskoma = tekstas.toUpperCase()
    let paliesta = 0

    setRows((prev) =>
      prev.map((row) => {
        if (row.categoryId !== null || row.isTransfer || row.isDuplicate) return row
        const seno = `${row.counterpartyName ?? ''} ${row.description ?? ''}`.toUpperCase()
        if (!seno.includes(ieskoma)) return row
        paliesta++
        return { ...row, categoryId }
      })
    )

    return paliesta
  }

  async function handleConfirm() {
    const siunciamos = rows.filter((r) => !r.isDuplicate && !praleistos.has(r.fingerprint))
    if (siunciamos.length === 0) return setError('Nėra ką importuoti.')

    setBusy(true)
    setError(null)

    try {
      const res = await fetch('/api/import/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: siunciamos, owner: preview!.owner }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.klaida ?? 'Nepavyko išsaugoti.')

      setDone(`Išsaugota operacijų: ${data.saved}.`)
      setPreview(null)
      setRows([])
      setPraleistos(new Set())
      if (fileInput.current) fileInput.current.value = ''
      onImported()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nepavyko išsaugoti.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <form onSubmit={handlePreview} className="upload">
        <label>
          Banko išrašas (CSV)
          <input type="file" accept=".csv,text/csv" ref={fileInput} />
        </label>

        <label>
          Kieno išrašas
          <select value={owner} onChange={(e) => setOwner(e.target.value)}>
            {savininkai.map((n) => (
              <option key={n.id}>{n.name}</option>
            ))}
          </select>
        </label>

        <button type="submit" disabled={busy}>
          {busy ? 'Skaitoma...' : 'Peržiūrėti'}
        </button>
      </form>

      {error && <p className="error">{error}</p>}
      {done && <p className="done">{done}</p>}

      {preview && (
        <>
          <h2>Peržiūra prieš importą</h2>
          <p className="bank">
            Atpažintas bankas: <strong>{preview.bank === 'seb' ? 'SEB' : 'Swedbank'}</strong> ·
            išrašo savininkas: <strong>{preview.owner}</strong>
          </p>

          <ul className="summary">
            <li>
              Bus importuota: <strong>{santrauka.importuosim}</strong>
            </li>
            {santrauka.dublikatai > 0 && (
              <li>
                Jau buvo anksčiau: <strong>{santrauka.dublikatai}</strong>
              </li>
            )}
            {santrauka.praleistos > 0 && (
              <li>
                Praleisi: <strong>{santrauka.praleistos}</strong>
              </li>
            )}
            <li className={santrauka.beKategorijos > 0 ? 'warn' : undefined}>
              Be kategorijos: <strong>{santrauka.beKategorijos}</strong>
            </li>
          </ul>

          {preview.skipped.length > 0 && (
            <p className="skipped">
              Praleista tarnybinių eilučių:{' '}
              {preview.skipped.map((s) => `${s.reason} (${s.count})`).join(', ')}
            </p>
          )}

          <p className="paaiskinimas">
            Spustelėk grupę, kad išskleistum kategorijas, o kategoriją — kad matytum operacijas.
            Kategorijas gali tvarkyti čia pat; importuota bus tai, ką matai.
          </p>

          <KategorijuMedis
            rows={medzioEilutes}
            categories={categories}
            onChangeCategory={keistiKategorija}
            onCreateRule={setTaisykleiEilute}
            onSkip={(key) => setPraleistos((prev) => new Set(prev).add(key))}
          />

          <button onClick={handleConfirm} disabled={busy} className="confirm">
            {busy ? 'Saugoma...' : `Importuoti ${santrauka.importuosim} operacijas`}
          </button>
        </>
      )}

      {taisykleiEilute && (
        <TaisyklesDialogas
          categories={categories}
          pradinisTekstas={taisykleiEilute.counterpartyName ?? ''}
          pradineKategorija={taisykleiEilute.categoryId}
          siulytiTaikytiEsamoms={false}
          onClose={() => setTaisykleiEilute(null)}
          onSaved={({ tekstas, categoryId }) => {
            const paliesta = pritaikytiTaisykle(tekstas, categoryId)
            setTaisykleiEilute(null)
            setDone(`Taisyklė sukurta. Šiame išraše ji sutvarkė operacijų: ${paliesta}.`)
          }}
        />
      )}
    </section>
  )
}
