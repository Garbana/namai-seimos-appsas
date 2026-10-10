import { createContext, useContext } from 'react'
import { request } from './api'

/** Neprivalomi moduliai (backend/src/nustatymai.ts). */
export type Modulis = 'finansai' | 'asistentas' | 'claude' | 'google'

export type Nustatymai = { seima: string; moduliai: Modulis[] }

/** Kol neįkelta — viskas įjungta (kad ekranai nemirgėtų). */
export const NUMATYTI: Nustatymai = { seima: '', moduliai: ['finansai', 'asistentas', 'claude', 'google'] }

export const gautiNustatymus = () => request<Nustatymai>('/api/nustatymai')

export const NustatymuKontekstas = createContext<Nustatymai>(NUMATYTI)

/** Ar modulis įjungtas šioje šeimoje. */
export function useModulis(m: Modulis): boolean {
  return useContext(NustatymuKontekstas).moduliai.includes(m)
}
