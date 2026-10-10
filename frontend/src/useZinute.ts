import { useEffect, useState } from 'react'

export type ZinutesDuomenys = {
  tekstas: string
  veiksmas?: { pavadinimas: string; atlikti: () => void }
}

/** Trumpa žinutė ekrano apačioje (pvz. „Atlikta · Atšaukti“), dingsta pati po 8 s. */
export function useZinute() {
  const [zinute, setZinute] = useState<ZinutesDuomenys | null>(null)

  useEffect(() => {
    if (!zinute) return
    const laikas = setTimeout(() => setZinute(null), 8000)
    return () => clearTimeout(laikas)
  }, [zinute])

  return [zinute, setZinute] as const
}
