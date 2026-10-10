import type { Category } from './api'

type Props = {
  categories: Category[]
  onOpen: (group: Category) => void
}

/**
 * Sritys, kurios anksčiau gyveno tik grupių ekranuose ir dėl to pasislėpdavo.
 * `grupe` — kategorijų grupės pavadinimas bazėje.
 */
const SRITYS = [
  {
    grupe: 'Taupymas',
    vardas: 'Taupymas ir investicijos',
    ikona: '↗',
    aprasas: 'Katiliukai, ETF portfelis, tikslai ir įnašai',
  },
  {
    grupe: 'Pensijos',
    vardas: 'Pensijos',
    ikona: '⧗',
    aprasas: 'II ir III pakopa, PZU, GPM grąža',
  },
  {
    grupe: 'Draudimas',
    vardas: 'Draudimai',
    ikona: '⛨',
    aprasas: 'Polisai, įmokos, draudimo sumos ir sąlygos',
  },
  {
    grupe: 'Kreditai',
    vardas: 'Kreditai',
    ikona: '▤',
    aprasas: 'Būsto paskola ir automobilio lizingas',
  },
]

/**
 * Turto skiltis. Kol kas — kelrodis į keturias sritis; grynasis turtas su
 * sumomis ir grafiku ateis atskiru etapu (žr. DIZAINAS.md).
 */
export default function Turtas({ categories, onOpen }: Props) {
  const grupes = new Map(categories.filter((c) => c.parent_id === null).map((c) => [c.name, c]))

  return (
    <section className="turto-sritys">
      <p className="paaiskinimas">
        Viskas, kas kaupiama ar skolinama, vienoje vietoje. Paspaudus atsidaro tos srities skiltis.
      </p>

      {SRITYS.map((sritis) => {
        const grupe = grupes.get(sritis.grupe)
        if (!grupe) return null
        return (
          <button key={sritis.grupe} className="turto-sritis" onClick={() => onOpen(grupe)}>
            <span className="turto-ikona" aria-hidden="true">
              {sritis.ikona}
            </span>
            <span className="turto-tekstas">
              <b>{sritis.vardas}</b>
              <small>{sritis.aprasas}</small>
            </span>
            <span className="turto-rodykle" aria-hidden="true">
              ›
            </span>
          </button>
        )
      })}
    </section>
  )
}
