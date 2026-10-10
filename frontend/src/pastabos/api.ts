import { request } from '../api'

export type Rusis = 'klaida' | 'nepatogu' | 'ideja' | 'asistentas'
export type Busena = 'nauja' | 'sutvarkyta' | 'atmesta'

/** Pastaba apie appsą (žr. backend/src/pastabos.ts). */
export type Pastaba = {
  id: number
  kind: Rusis
  text: string
  screen: string | null
  details: string | null
  ai_request_id: number | null
  member_id: number | null
  status: Busena
  resolution: string | null
  created_at: string
  resolved_at: string | null
}

export const RUSYS: { reiksme: Rusis; vardas: string }[] = [
  { reiksme: 'klaida', vardas: '🐞 Klaida' },
  { reiksme: 'nepatogu', vardas: '😕 Nepatogu' },
  { reiksme: 'ideja', vardas: '💡 Idėja' },
  { reiksme: 'asistentas', vardas: '🐱 Asistentas' },
]

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const pastabos = {
  sarasas: () => request<Pastaba[]>('/api/pastabos'),
  sukurti: (laukai: { kind: Rusis; text: string; screen?: string | null; aiRequestId?: number }, memberId: number | null) =>
    request<Pastaba>('/api/pastabos', json('POST', { ...laukai, memberId })),
  keisti: (id: number, laukai: { status?: Busena; text?: string }) => request<Pastaba>(`/api/pastabos/${id}`, json('PATCH', laukai)),
  istrinti: (id: number) => request<{ ok: true }>(`/api/pastabos/${id}`, { method: 'DELETE' }),
}
