import { request } from '../api'

/** Claude programos prašymas prisijungti (žr. backend/src/claude.ts). */
export type Prasymas = {
  programa: string
  /** Kur bus išsiųstas raktas (pvz., claude.ai). */
  adresas: string
  /** Raktas keliauja programai šiame kompiuteryje (localhost). */
  vietine: boolean
  busena: 'laukia' | 'leista' | 'atmesta' | 'prijungta' | 'atjungta'
  pasibaige: boolean
  /** Kur grįžti po sprendimo (Claude jungties Worker'is). */
  toliau: string
}

export type Jungtis = {
  id: number
  programa: string
  narys: string | null
  prijungta: string
  naudota: string | null
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const claude = {
  prasymas: (state: string) => request<Prasymas>(`/api/claude/prasymas?state=${encodeURIComponent(state)}`),
  spresti: (state: string, narys: number | null, leisti: boolean) =>
    request<{ toliau: string }>('/api/claude/prasymas', json({ state, narys, leisti })),
  jungtys: () => request<{ adresas: string; jungtys: Jungtis[] }>('/api/claude/jungtys'),
  atjungti: (id: number) => request<{ ok: true }>(`/api/claude/jungtys/${id}/atjungti`, json({})),
}
