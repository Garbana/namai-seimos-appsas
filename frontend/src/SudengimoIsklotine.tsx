import { eur, type Sudengimas } from './api'

type Props = {
  /** Pradinė išlaidos suma iš banko išrašo (neigiama). */
  amountCents: number
  offsets: Sudengimas[]
  onUnlink?: (incomeId: number) => void
}

/** „Pradinė −100 € · +90 € iš draudimo · lieka −10 €" — kad sudengimas būtų matomas, o ne tyliai sumažintų išlaidą. */
export default function SudengimoIsklotine({ amountCents, offsets, onUnlink }: Props) {
  const sudengta = offsets.reduce((s, o) => s + o.amount_cents, 0)

  return (
    <div className="sudengimas-isklotine">
      <div>
        <span>Pradinė suma</span>
        <span className="num">{eur(amountCents)}</span>
      </div>
      {offsets.map((o) => (
        <div key={o.id}>
          <span>
            Sudengta: {o.counterparty_name ?? '—'} · {o.booking_date}
            {o.account_owner ? ` · ${o.account_owner}` : ''}
            {onUnlink && (
              <button className="ghost small" onClick={() => onUnlink(o.id)}>
                atsieti
              </button>
            )}
          </span>
          <span className="num income">+{eur(o.amount_cents)}</span>
        </div>
      ))}
      <div className="liko">
        <span>Lieka</span>
        <span className="num">{eur(amountCents + sudengta)}</span>
      </div>
    </div>
  )
}
