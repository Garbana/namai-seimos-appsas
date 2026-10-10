import { createContext, useContext } from 'react'
import type { Narys } from './api'

export type NariuDuomenys = {
  nariai: Narys[]
  /** Šio įrenginio žmogus; null — dar nežinoma (appsas paklaus). */
  as: number | null
  keistiAs: (id: number) => void
}

export const NariuKontekstas = createContext<NariuDuomenys>({ nariai: [], as: null, keistiAs: () => {} })

export const useNariai = () => useContext(NariuKontekstas)
