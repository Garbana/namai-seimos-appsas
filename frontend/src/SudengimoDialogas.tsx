import { useEffect, useState } from 'react'
import { api, eur, type Transaction } from './api'

type Props = {
  transaction: Transaction
  onClose: () => void
  onSaved: (zinute: string) => void
}

/** Kiek dienų į priekį / atgal ieškoti poros pagal nutylėjimą. */
const LANGAS_DIENOMIS = 120

/** „2026-07-03" + 30 -> „2026-08-02". */
function pridetiDienu(data: string, dienos: number) {
  const d = new Date(`${data}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dienos)
  return d.toISOString().slice(0, 10)
}

/** Kiek išlaidos dar liko nesudengta (neigiamas skaičius arba 0). */
const likutis = (t: Transaction) => t.amount_cents + t.offset_cents

/**
 * Atsidaro iš abiejų pusių: nuo išlaidos renkamės ją dengiančias įplaukas
 * (gali būti kelios, pvz. keli kolegos), nuo įplaukos — vieną išlaidą.
 */
export default function SudengimoDialogas({ transaction, onClose, onSaved }: Props) {
  const islaida = transaction.amount_cents < 0

  const [search, setSearch] = useState('')
  const [from, setFrom] = useState(
    islaida ? transaction.booking_date : pridetiDienu(transaction.booking_date, -LANGAS_DIENOMIS)
  )
  const [to, setTo] = useState(
    islaida ? pridetiDienu(transaction.booking_date, LANGAS_DIENOMIS) : transaction.booking_date
  )
  const [kandidatai, setKandidatai] = useState<Transaction[] | null>(null)
  // Map, o ne id rinkinys: pakeitus filtrą pasirinktos operacijos iš sąrašo
  // dingsta, bet jų sumos vis tiek reikia.
  const [pasirinkti, setPasirinkti] = useState<Map<number, Transaction>>(new Map())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const laikas = setTimeout(async () => {
      try {
        const params: Record<string, string> = {
          direction: islaida ? 'income' : 'expense',
          hideOffsets: '1',
          limit: '200',
        }
        // Išlaidos, mažesnės už įplauką, jos niekada neišteks — nerodom, kad
        // neužgožtų tų, kurios tinka.
        if (!islaida) params.maxCents = String(-transaction.amount_cents)
        if (search) params.search = search
        if (from) params.from = from
        if (to) params.to = to
        setKandidatai((await api.transactions(params)).rows)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Nepavyko užkrauti operacijų.')
      }
    }, 250)
    return () => clearTimeout(laikas)
  }, [islaida, transaction.amount_cents, search, from, to])

  const pasirinktos = [...pasirinkti.values()]
  const liks = islaida
    ? likutis(transaction) + pasirinktos.reduce((s, t) => s + t.amount_cents, 0)
    : pasirinktos.length > 0
      ? likutis(pasirinktos[0]) + transaction.amount_cents
      : 0
  const virsija = liks > 0

  function pasirinkti_(t: Transaction) {
    setError(null)
    setPasirinkti((prev) => {
      if (!islaida) return new Map([[t.id, t]])
      const next = new Map(prev)
      next.has(t.id) ? next.delete(t.id) : next.set(t.id, t)
      return next
    })
  }

  async function save() {
    if (pasirinkti.size === 0) {
      return setError(islaida ? 'Pasirink bent vieną įplauką.' : 'Pasirink išlaidą.')
    }
    setSaving(true)
    try {
      if (islaida) {
        const result = await api.linkOffsets(transaction.id, [...pasirinkti.keys()])
        onSaved(`Išlaida sudengta (${result.linked} įplaukos). Lieka ${eur(liks)}.`)
      } else {
        await api.linkOffsets(pasirinktos[0].id, [transaction.id])
        onSaved(`Įplauka sudengta su išlaida. Išlaidos lieka ${eur(liks)}.`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nepavyko sudengti.')
      setSaving(false)
    }
  }

  return (
    <div className="modal-fonas" onClick={onClose}>
      <div className="modal platus" onClick={(e) => e.stopPropagation()}>
        <h3>{islaida ? 'Sudengti išlaidą' : 'Sudengti įplauką su išlaida'}</h3>
        <p className="paaiskinimas">
          {transaction.counterparty_name ?? '—'} · {transaction.booking_date} ·{' '}
          <strong>{eur(transaction.amount_cents)}</strong>
          <br />
          {islaida
            ? 'Pasirink įplaukas (draudimo kompensaciją, kolegų grąžintus pinigus), kurios dengia šią išlaidą. Jos nebus skaičiuojamos kaip pajamos, o sumažins šią išlaidą jos mėnesį.'
            : 'Pasirink išlaidą, kurią ši įplauka dengia. Įplauka nebus skaičiuojama kaip pajamos, o sumažins pasirinktą išlaidą jos mėnesį.'}
        </p>

        {islaida && transaction.offset_cents > 0 && (
          <p className="paaiskinimas">
            Jau sudengta {eur(transaction.offset_cents)}, lieka {eur(likutis(transaction))}.
          </p>
        )}

        <div className="sudengimo-filtrai">
          <input
            type="search"
            placeholder="Ieškoti gavėjo ar paskirties"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>

        <div className="sudengimo-sarasas">
          {!kandidatai && <p className="tuscia">Kraunama...</p>}
          {kandidatai?.length === 0 && (
            <p className="tuscia">
              {islaida ? 'Įplaukų' : 'Išlaidų'} šiame laikotarpyje nerasta. Pakeisk datas ar paiešką.
            </p>
          )}
          {kandidatai?.map((k) => {
            const negalima = !islaida && likutis(k) + transaction.amount_cents > 0
            return (
              <label
                key={k.id}
                className={negalima ? 'sudengimo-eilute negalima' : 'sudengimo-eilute'}
                title={negalima ? 'Įplauka didesnė už likusią šios išlaidos sumą' : (k.description ?? undefined)}
              >
                <input
                  type={islaida ? 'checkbox' : 'radio'}
                  name="sudengimas"
                  checked={pasirinkti.has(k.id)}
                  disabled={negalima}
                  onChange={() => pasirinkti_(k)}
                />
                <span className="nowrap">{k.booking_date}</span>
                <span>
                  {k.counterparty_name ?? k.description?.slice(0, 45) ?? '—'}
                  <span className="sub">
                    {k.category_name ?? 'be kategorijos'}
                    {k.account_owner ? ` · ${k.account_owner}` : ''}
                  </span>
                </span>
                <span className={islaida ? 'num income' : 'num'}>
                  {eur(islaida ? k.amount_cents : likutis(k))}
                  {!islaida && k.offset_cents > 0 && (
                    <span className="sub">iš {eur(k.amount_cents)}</span>
                  )}
                </span>
              </label>
            )
          })}
        </div>

        <div className="skaidymo-apacia">
          <span>{pasirinkti.size > 0 && `Išlaidos liks: ${eur(liks)}`}</span>
          {virsija && <span className="warn">Sudengimas viršija išlaidą</span>}
        </div>

        {error && <p className="error">{error}</p>}

        <div className="modal-mygtukai">
          <button className="ghost" onClick={onClose}>
            Atšaukti
          </button>
          <button onClick={save} disabled={saving || pasirinkti.size === 0 || virsija}>
            {saving ? 'Saugoma...' : 'Sudengti'}
          </button>
        </div>
      </div>
    </div>
  )
}
