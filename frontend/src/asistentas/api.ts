import { request } from '../api'
import type { UzduotiesLaukai } from '../darbai/api'
import type { IvykioLaukai } from '../kalendorius/api'

export type Tipas =
  | 'sukurti'
  | 'keisti'
  | 'istrinti'
  | 'atlikta'
  | 'pirkiniai'
  | 'nupirkta'
  | 'pastaba'
  | 'projektas'
  | 'islaida'
  | 'ivykis'
  | 'ivykio_keitimas'
  | 'ivykio_trynimas'

/** Asistento pasiūlytas projektas (sumos — centais). */
export type ProjektoPlanas = {
  title: string
  goal: string | null
  targetDate: string | null
  budgetCents: number | null
  areaId: number | null
  ownerId: number | null
  sections: { name: string; tasks: { title: string; dueDate?: string | null; dueTime?: string | null; assigneeId?: number | null; amountCents?: number | null }[] }[]
  costs: { name: string; plannedCents?: number | null; isEstimate?: boolean; taskTitle?: string }[]
}
export type Busena = 'laukia' | 'ivykdyta' | 'atmesta' | 'pakeista' | 'atsaukta' | 'klaida'

/** Asistento veiksmas (žr. backend/src/ai/veiksmai.ts). */
export type Veiksmas = {
  id: string
  tipas: Tipas
  busena: Busena
  klaida?: string
  laukai?: UzduotiesLaukai
  pouzduotys?: string[]
  uzduotisId?: number
  pavadinimas?: string
  pries?: UzduotiesLaukai
  sarasasId?: number
  prekes?: { id?: number; name: string; quantity: string | null }[]
  sumaCentais?: number | null
  pastaba?: { kind: 'klaida' | 'nepatogu' | 'ideja' | 'asistentas'; text: string }
  projektas?: ProjektoPlanas
  projektasId?: number
  etapas?: string | null
  islaida?: { projectId: number; projektas: string; costId: number | null; name: string; actualCents: number }
  /** Kalendoriaus įvykis: naujas — visi laukai, keičiamas — tik keičiami (ivykisPries — kaip buvo). */
  ivykis?: IvykioLaukai
  ivykisPries?: IvykioLaukai
  ivykisId?: number
}

export type Irasas = {
  id: number
  pokalbisId: number
  memberId: number | null
  tekstas: string
  atsakymas: string | null
  veiksmai: Veiksmas[]
  klaida: string | null
  createdAt: string
}

export type Istorija = {
  irasai: Irasas[]
  islaidos: { menuoUzklausu: number; menuoKainaUsd: number; siandienUzklausu: number; dienosRiba: number }
  ijungtas: boolean
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const asistentas = {
  klausti: (tekstas: string, memberId: number | null, pokalbisId: number | null, ekranas: string | null) =>
    request<Irasas & { pokalbis: Irasas[] }>('/api/asistentas', json({ tekstas, memberId, pokalbisId, ekranas })),
  patvirtinti: (
    id: number,
    memberId: number | null,
    veiksmai?: string[],
    pataisyta?: Record<string, { laukai: UzduotiesLaukai; pouzduotys?: string[] }>
  ) => request<Irasas>(`/api/asistentas/${id}/patvirtinti`, json({ memberId, veiksmai, pataisyta })),
  atmesti: (id: number, veiksmas: string) => request<Irasas>(`/api/asistentas/${id}/atmesti`, json({ veiksmas })),
  atsaukti: (id: number, veiksmas: string, memberId: number | null) =>
    request<Irasas>(`/api/asistentas/${id}/atsaukti`, json({ veiksmas, memberId })),
  istorija: () => request<Istorija>('/api/asistentas/istorija'),
}
