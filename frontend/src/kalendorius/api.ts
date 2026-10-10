import { request } from '../api'

/** Kalendoriaus įvykis (vienas kartas), žr. backend/src/kalendorius/ivykiai.ts. */
export type Ivykis = {
  id: number
  title: string
  notes: string | null
  location: string | null
  start_date: string
  start_time: string | null
  end_date: string
  end_time: string | null
  members: number[]
  recurrence: string | null
  /** Pasikartojančio įvykio kartas. */
  series: boolean
  source: 'rankinis' | 'ai' | 'claude' | 'google'
  google: boolean
  google_id: string | null
  sync_state: 'laukia' | 'sinchronizuota' | 'klaida'
  sync_error: string | null
}

/** Užduotis su terminu kalendoriuje. */
export type KalendoriausUzduotis = {
  id: number
  title: string
  due_date: string
  due_time: string | null
  assignee_id: number | null
  chore: number
  project_id: number | null
}

export type KalendoriausDuomenys = {
  ivykiai: Ivykis[]
  uzduotys: KalendoriausUzduotis[]
  google: { prijungta: boolean; kalendorius: string | null; klaida: string | null; nesinchronizuota: number }
}

export type IvykioLaukai = Partial<{
  title: string
  startDate: string
  startTime: string | null
  endDate: string
  endTime: string | null
  memberIds: number[]
  location: string | null
  notes: string | null
  recurrence: string | null
}>

export type GoogleBusena = {
  paskyra: string | null
  kalendorius: string | null
  paskutinis: string | null
  klaida: string | null
  importuojama: boolean
  laukia: number
  klaidos: number
}

/** Nuoroda į įvykį Google kalendoriuje (atsidaro šeimos paskyroje). */
export const googleNuoroda = (googleId: string, kalendoriausId: string) =>
  `https://calendar.google.com/calendar/event?eid=${btoa(`${googleId} ${kalendoriausId}`).replace(/=+$/, '')}`

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const kalendorius = {
  intervalas: (nuo: string, iki: string) => request<KalendoriausDuomenys>(`/api/kalendorius?nuo=${nuo}&iki=${iki}`),
  ivykis: (id: number) => request<Ivykis>(`/api/kalendorius/${id}`),
  sukurti: (laukai: IvykioLaukai, memberId: number | null) => request<Ivykis>('/api/kalendorius', json('POST', { ...laukai, memberId })),
  /** visiems — pasikartojančio įvykio visi kartai. */
  keisti: (id: number, laukai: IvykioLaukai, visiems = false) => request<Ivykis | { ok: true }>(`/api/kalendorius/${id}`, json('PATCH', { ...laukai, visiems })),
  istrinti: (id: number, visiems = false) => request<{ ok: true }>(`/api/kalendorius/${id}${visiems ? '?visiems=1' : ''}`, { method: 'DELETE' }),
  atkurti: (id: number) => request<Ivykis>(`/api/kalendorius/${id}/atkurti`, { method: 'POST' }),

  google: () => request<GoogleBusena>('/api/kalendorius/google'),
  prijungtiGoogle: (calendarId: string) => request<{ ok: true; klaida: string | null }>('/api/kalendorius/google', json('POST', { calendarId })),
  atjungtiGoogle: () => request<{ ok: true }>('/api/kalendorius/google', { method: 'DELETE' }),
  sinchronizuoti: () => request<{ ok: boolean; klaida: string | null }>('/api/kalendorius/google/sinchronizuoti', { method: 'POST' }),
}
