import { useCallback, useEffect, useRef, useState } from 'react'
import { useZinute } from '../useZinute'
import { darbai, type Sritis, type Uzduotis } from './api'
import { pilnaData } from './datos'
import { useNariai } from './nariai'

const klaidosTekstas = (err: unknown) => (err instanceof Error ? err.message : 'Nepavyko.')

/**
 * Užduotys ir sritys vienam ekranui, kartu su atlikimu ir „Atšaukti“. Naudoja ir
 * „Šiandien“, ir „Užduotys“, kad abu elgtųsi vienodai.
 */
export function useUzduotys() {
  const { as, nariai } = useNariai()
  const [uzduotys, setUzduotys] = useState<Uzduotis[] | null>(null)
  const [sritys, setSritys] = useState<Sritis[]>([])
  const [klaida, setKlaida] = useState<string | null>(null)
  const [zinute, setZinute] = useZinute()

  // Taikom tik naujausios užklausos atsakymą — senesnis, grįžęs vėliau, neuždengia naujų pakeitimų.
  const naujausia = useRef(0)
  const load = useCallback(() => {
    const nr = ++naujausia.current
    Promise.all([darbai.uzduotys(), darbai.sritys()])
      .then(([u, s]) => {
        if (nr !== naujausia.current) return
        setUzduotys(u)
        setSritys(s)
      })
      .catch((err) => setKlaida(klaidosTekstas(err)))
  }, [])

  useEffect(() => load(), [load])

  const atsaukti = useCallback(
    (u: Uzduotis) =>
      darbai
        .atsaukti(u.id)
        .then(load)
        .catch((err) => setKlaida(klaidosTekstas(err))),
    [load]
  )

  /** Apskritimo paspaudimas: atvira — atlikta (su „Atšaukti“), atlikta — vėl atvira. */
  const atlikti = useCallback(
    async (u: Uzduotis) => {
      setKlaida(null)
      if (u.status === 'atlikta') {
        await atsaukti(u)
        return
      }
      try {
        // Iškart parodom, kad pažymėta — tinklas gali užtrukti.
        setUzduotys((prev) => prev && prev.map((x) => (x.id === u.id && !u.recurrence ? { ...x, status: 'atlikta' } : x)))
        const { task, nextDue } = await darbai.atlikta(u.id, as)
        load()
        // Pakaitomis — pasakom ir kieno eilė dabar.
        const kitas = task.rotation_members ? nariai.find((n) => n.id === task.assignee_id)?.name : undefined
        setZinute({
          tekstas: nextDue ? `Atlikta. Kitą kartą — ${pilnaData(nextDue)}${kitas ? `, ${kitas}` : ''}` : `Atlikta: ${u.title}`,
          veiksmas: { pavadinimas: 'Atšaukti', atlikti: () => void atsaukti(u) },
        })
      } catch (err) {
        setKlaida(klaidosTekstas(err))
        load()
      }
    },
    [as, nariai, atsaukti, load, setZinute]
  )

  return { uzduotys, sritys, klaida, setKlaida, load, atlikti, zinute, setZinute }
}
