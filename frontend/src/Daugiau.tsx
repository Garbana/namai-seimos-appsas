import type { ReactNode } from 'react'
import { useNariai } from './darbai/nariai'

type Skiltis = 'importas' | 'taisykles' | 'kopijos' | 'siuksliadeze' | 'sritys' | 'pranesimai' | 'asistentas' | 'pastabos' | 'claude' | 'google'

type Props = {
  onEiti: (skiltis: Skiltis) => void
  onKeistiAs: () => void
  temosJungiklis: ReactNode
  /** Ar skiltis rodoma (išjungto modulio — ne). */
  matoma: (skiltis: Skiltis) => boolean
}

const EILUTES: { skiltis: Skiltis; ikona: string; vardas: string; aprasas: string }[] = [
  { skiltis: 'importas', ikona: '⇅', vardas: 'Importuoti išrašą', aprasas: 'Banko CSV — operacijos susikategorizuoja pačios' },
  { skiltis: 'taisykles', ikona: '⚙', vardas: 'Taisyklės', aprasas: 'Kaip operacijos priskiriamos kategorijoms' },
  { skiltis: 'pastabos', ikona: '✎', vardas: 'Pastabos ir klaidos', aprasas: 'Kas netinka ar ko norėtųsi — Claude pažiūrės ir pataisys' },
  { skiltis: 'asistentas', ikona: '✦', vardas: 'Asistentas', aprasas: 'Ką padarė asistentas ir kiek tai kainavo' },
  { skiltis: 'google', ikona: '⇄', vardas: 'Google kalendorius', aprasas: 'Appso kalendorius sinchronizuojasi su šeimos Google kalendoriumi' },
  { skiltis: 'claude', ikona: '✳', vardas: 'Claude jungtis', aprasas: 'Planuok su Claude programa — planai keliauja į appsą' },
  { skiltis: 'pranesimai', ikona: '◔', vardas: 'Pranešimai', aprasas: 'Priminimai ir rytinė suvestinė šiame telefone' },
  { skiltis: 'sritys', ikona: '▦', vardas: 'Sritys ir atsakingi', aprasas: 'Kas pagal nutylėjimą atsakingas už kurią sritį' },
  { skiltis: 'siuksliadeze', ikona: '♲', vardas: 'Šiukšliadėžė', aprasas: 'Ištrintos užduotys — 30 dienų' },
  { skiltis: 'kopijos', ikona: '⤓', vardas: 'Atsarginės kopijos', aprasas: 'Parsisiųsti duomenis į kompiuterį' },
]

/** Telefone — viskas, kas netilpo į apatinę juostą. Kompiuteryje tas pats šoninėje juostoje. */
export default function Daugiau({ onEiti, onKeistiAs, temosJungiklis, matoma }: Props) {
  const { nariai, as } = useNariai()
  const asVardas = nariai.find((n) => n.id === as)?.name

  return (
    <div className="daugiau">
      {EILUTES.filter((e) => matoma(e.skiltis)).map((e) => (
        <button key={e.skiltis} className="daugiau-eilute" onClick={() => onEiti(e.skiltis)}>
          <span aria-hidden="true">{e.ikona}</span>
          <span>
            <b>{e.vardas}</b>
            <small>{e.aprasas}</small>
          </span>
          <span aria-hidden="true">›</span>
        </button>
      ))}

      <button className="daugiau-eilute" onClick={onKeistiAs}>
        <span aria-hidden="true">●</span>
        <span>
          <b>Šį įrenginį naudoja: {asVardas ?? 'nenurodyta'}</b>
          <small>Pagal tai žymima, kas pridėjo ir atliko darbus, ir kam ateina pranešimai</small>
        </span>
        <span aria-hidden="true">›</span>
      </button>

      <div className="daugiau-tema">{temosJungiklis}</div>
    </div>
  )
}
