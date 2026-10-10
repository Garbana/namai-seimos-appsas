import { createContext, useContext } from 'react'
import type { Category } from './api'

/**
 * Kategorijų sąrašas laikomas App lygyje. Per šį kontekstą bet kuris
 * kategorijos pasirinkimas gali pridėti naujai sukurtą kategoriją, ir ji iškart
 * atsiranda visuose sąrašuose be puslapio perkrovimo.
 */
export const KategorijuKontekstas = createContext<(category: Category) => void>(() => {})

export const usePridetiKategorija = () => useContext(KategorijuKontekstas)
