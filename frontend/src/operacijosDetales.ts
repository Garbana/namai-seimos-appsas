import { eur, type Transaction } from './api'

export type Detale = { etikete: string; reiksme: string }

/**
 * Visa banko informacija apie operaciją — tas pats rinkinys visuose ekranuose,
 * kad išskleidus bet kurią operaciją matytųsi, iš kur ji ir kodėl ten, kur yra.
 * Tuščios reikšmės praleidžiamos, kad nebūtų brūkšnelių eilės.
 */
export function operacijosDetales(t: Transaction): Detale[] {
  if (t.notes === 'excel-istorija') {
    return [
      {
        etikete: 'Šaltinis',
        reiksme: 'Istorinė mėnesio suma iš „Šeimos buhalterijos" Excel — ne banko operacija.',
      },
    ]
  }

  const islaida = t.amount_cents < 0
  const bankoData = t.parent_booking_date ?? t.booking_date

  const kategorijosSaltinis = t.is_transfer
    ? t.rule_id
      ? `vidinis pervedimas (taisyklė Nr. ${t.rule_id})`
      : 'vidinis pervedimas'
    : t.category_id === null
      ? null
      : t.rule_id
        ? `priskyrė taisyklė Nr. ${t.rule_id}`
        : 'priskirta rankiniu būdu'

  const eilutes: { etikete: string; reiksme: string | null | undefined }[] = [
    { etikete: 'Mokėjimo paskirtis', reiksme: t.description },
    { etikete: islaida ? 'Gavėjas' : 'Mokėtojas', reiksme: t.counterparty_name },
    { etikete: islaida ? 'Gavėjo sąskaita' : 'Mokėtojo sąskaita', reiksme: t.counterparty_account },
    {
      etikete: 'Mūsų sąskaita',
      reiksme: [t.account_owner, t.account_bank?.toUpperCase(), t.iban_last4 && `···${t.iban_last4}`]
        .filter(Boolean)
        .join(' · '),
    },
    { etikete: 'Data banke', reiksme: bankoData },
    { etikete: 'Valiutavimo data', reiksme: t.value_date && t.value_date !== bankoData ? t.value_date : null },
    { etikete: 'Priskirta laikotarpiui', reiksme: t.booking_date !== bankoData ? t.booking_date : null },
    { etikete: 'Šalis', reiksme: t.country },
    { etikete: 'Operacijos tipas', reiksme: t.raw_type },
    { etikete: 'Banko operacijos nr.', reiksme: t.reference },
    { etikete: 'Kategorija', reiksme: kategorijosSaltinis },
    { etikete: 'Skaidymas', reiksme: t.parent_id !== null ? 'suskaidytos operacijos dalis' : null },
    {
      etikete: 'Sudengimas',
      reiksme:
        t.offset_of_id !== null
          ? `dengia išlaidą: ${t.offset_target_name ?? '—'} · ${t.offset_target_date ?? ''}` +
            (t.offset_target_amount !== null ? ` · ${eur(t.offset_target_amount)}` : '')
          : null,
    },
  ]

  return eilutes.filter((d): d is Detale => typeof d.reiksme === 'string' && d.reiksme.trim() !== '')
}
