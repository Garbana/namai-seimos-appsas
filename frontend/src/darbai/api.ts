import { request } from '../api'
import type { PirkiniuDuomenys } from './pirkiniuEile'

export type Narys = { id: number; name: string; color: string; uses_app: number }

export type Sritis = {
  id: number
  name: string
  icon: string | null
  default_member_id: number | null
  sort_order: number
}

export type Prioritetas = 'svarbu' | 'iprasta' | 'kada_nors'

export type Uzduotis = {
  id: number
  title: string
  notes: string | null
  parent_id: number | null
  area_id: number | null
  assignee_id: number | null
  priority: Prioritetas
  status: 'atvira' | 'atlikta'
  due_date: string | null
  due_time: string | null
  recurrence: string | null
  amount_cents: number | null
  completed_at: string | null
  completed_by: number | null
  created_at: string
  created_by: number | null
  source: string
  deleted_at: string | null
  /** Priminimai: '60m' — prieš 60 min., '1d@18:00' — dieną prieš 18:00. */
  reminders: string[]
  project_id: number | null
  section_id: number | null
  /** 1 — namų ruoša (rodoma „Ruošoje“, ne bendrame sąraše). */
  chore: number
  /** „Pakaitomis“: narių id eilė JSON ('[1,2]'). */
  rotation_members: string | null
  /** 1 — kartojama nuo atlikimo dienos. */
  repeat_after_done: number
}

export type UzduotiesLaukai = Partial<{
  title: string
  notes: string | null
  parentId: number | null
  areaId: number | null
  assigneeId: number | null
  priority: Prioritetas
  dueDate: string | null
  dueTime: string | null
  recurrence: string | null
  amountCents: number | null
  status: 'atvira' | 'atlikta'
  reminders: string[]
  projectId: number | null
  sectionId: number | null
  chore: boolean
  rotationMembers: number[] | null
  repeatAfterDone: boolean
}>

export type ProjektoBusena = 'aktyvus' | 'baigtas' | 'atidetas'

/** Projektas su suvestine (žr. backend/src/darbai/projektai.ts). */
export type Projektas = {
  id: number
  title: string
  goal: string | null
  area_id: number | null
  owner_id: number | null
  target_date: string | null
  budget_cents: number | null
  status: ProjektoBusena
  notes: string | null
  source: string
  created_at: string
  finished_at: string | null
  deleted_at: string | null
  tasks_total: number
  tasks_done: number
  planned_cents: number
  actual_cents: number
  next_due: string | null
  /** Susietas taupymo katiliukas. */
  savings_goal_id: number | null
}

export type Etapas = { id: number; project_id: number; name: string; sort_order: number }

export type Islaida = {
  id: number
  project_id: number
  name: string
  task_id: number | null
  planned_cents: number | null
  actual_cents: number | null
  is_estimate: number
  sort_order: number
  /** Ranka įvesta suma, kol faktas imamas iš banko operacijų. */
  manual_actual_cents?: number | null
  /** Kiek banko operacijų susieta (tada faktas — jų suma). */
  bank_links?: number
}

/** Katiliukas, kuriame kaupiama projektui (7 etapas). */
export type ProjektoKatiliukas = { id: number; name: string; valueCents: number; targetCents: number | null }

export type ProjektoDuomenys = {
  project: Projektas
  sections: Etapas[]
  costs: Islaida[]
  tasks: Uzduotis[]
  savings?: ProjektoKatiliukas | null
}

/** Banko operacija projekto ekrane (žr. backend/src/darbai/bankas.ts). */
export type BankoOperacija = {
  transaction_id: number
  booking_date: string
  amount_cents: number
  counterparty_name: string | null
  description: string | null
  account_owner: string | null
  category_name: string | null
}

export type ProjektoBankas = {
  links: (BankoOperacija & { cost_id: number; cost_name: string })[]
  suggestions: (BankoOperacija & { reason: string; cost_id: number | null })[]
}

/** Operacijos ekranui: kuriam projektui priskirta ir kuriems galima. */
export type OperacijosProjektas = {
  link: { project_id: number; project_title: string; cost_id: number; cost_name: string } | null
  projects: { id: number; title: string; costs: { id: number; name: string }[] }[]
}

export type Susiejimas = { transactionId?: number; projectId?: number; costId?: number | null; costName?: string | null }

export type Sablonas = { code: string; name: string; icon: string; description: string }

export type ProjektoLaukai = Partial<{
  title: string
  goal: string | null
  areaId: number | null
  ownerId: number | null
  targetDate: string | null
  budgetCents: number | null
  notes: string | null
  status: ProjektoBusena
  savingsGoalId: number | null
}>

export type IslaidosLaukai = Partial<{
  name: string
  plannedCents: number | null
  actualCents: number | null
  taskId: number | null
}>

export type Sarasas = { id: number; name: string; sort_order: number }

export type Preke = {
  id: number
  list_id: number
  name: string
  quantity: string | null
  added_by: number | null
  added_at: string
  checked_at: string | null
  checked_by: number | null
  /** Parduotuvės skyrius („Pieno produktai ir kiaušiniai“). */
  section: string | null
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

/** `memberId` — kas daro veiksmą (šio įrenginio narys); visi vis tiek mato viską. */
export const darbai = {
  nariai: () => request<{ nariai: Narys[] }>('/api/nariai'),

  sritys: () => request<Sritis[]>('/api/darbai/sritys'),
  sukurtiSriti: (laukai: { name: string; icon: string | null; defaultMemberId: number | null }) =>
    request<Sritis>('/api/darbai/sritys', json('POST', laukai)),
  keistiSriti: (id: number, laukai: { name: string; icon: string | null; defaultMemberId: number | null }) =>
    request<Sritis>(`/api/darbai/sritys/${id}`, json('PUT', laukai)),
  istrintiSriti: (id: number) => request<{ ok: true }>(`/api/darbai/sritys/${id}`, { method: 'DELETE' }),

  uzduotys: () => request<Uzduotis[]>('/api/darbai/uzduotys'),
  sukurti: (laukai: UzduotiesLaukai, memberId: number | null) =>
    request<Uzduotis>('/api/darbai/uzduotys', json('POST', { ...laukai, memberId })),
  keisti: (id: number, laukai: UzduotiesLaukai, memberId: number | null) =>
    request<Uzduotis>(`/api/darbai/uzduotys/${id}`, json('PATCH', { ...laukai, memberId })),
  atlikta: (id: number, memberId: number | null) =>
    request<{ task: Uzduotis; nextDue: string | null }>(`/api/darbai/uzduotys/${id}/atlikta`, json('POST', { memberId })),
  atsaukti: (id: number) => request<Uzduotis>(`/api/darbai/uzduotys/${id}/atsaukti`, { method: 'POST' }),
  istrinti: (id: number) => request<{ ok: true }>(`/api/darbai/uzduotys/${id}`, { method: 'DELETE' }),
  atkurti: (id: number) => request<Uzduotis>(`/api/darbai/uzduotys/${id}/atkurti`, { method: 'POST' }),
  siuksliadeze: () => request<Uzduotis[]>('/api/darbai/siuksliadeze'),

  projektai: () => request<Projektas[]>('/api/darbai/projektai'),
  istrintiProjektai: () => request<Projektas[]>('/api/darbai/projektai?siuksliadeze=1'),
  sablonai: () => request<Sablonas[]>('/api/darbai/sablonai'),
  projektas: (id: number) => request<ProjektoDuomenys>(`/api/darbai/projektai/${id}`),
  sukurtiProjekta: (laukai: ProjektoLaukai & { sablonas?: string | null }, memberId: number | null) =>
    request<ProjektoDuomenys>('/api/darbai/projektai', json('POST', { ...laukai, memberId })),
  keistiProjekta: (id: number, laukai: ProjektoLaukai) =>
    request<ProjektoDuomenys>(`/api/darbai/projektai/${id}`, json('PATCH', laukai)),
  istrintiProjekta: (id: number) => request<{ ok: true }>(`/api/darbai/projektai/${id}`, { method: 'DELETE' }),
  atkurtiProjekta: (id: number) => request<ProjektoDuomenys>(`/api/darbai/projektai/${id}/atkurti`, { method: 'POST' }),
  sukurtiEtapa: (projectId: number, name: string) => request<Etapas>(`/api/darbai/projektai/${projectId}/etapai`, json('POST', { name })),
  keistiEtapa: (id: number, laukai: { name?: string; sortOrder?: number }) => request<Etapas>(`/api/darbai/etapai/${id}`, json('PATCH', laukai)),
  istrintiEtapa: (id: number) => request<{ ok: true }>(`/api/darbai/etapai/${id}`, { method: 'DELETE' }),
  sukurtiIslaida: (projectId: number, laukai: IslaidosLaukai) =>
    request<Islaida>(`/api/darbai/projektai/${projectId}/islaidos`, json('POST', laukai)),
  keistiIslaida: (id: number, laukai: IslaidosLaukai) => request<Islaida>(`/api/darbai/islaidos/${id}`, json('PATCH', laukai)),
  istrintiIslaida: (id: number) => request<{ ok: true }>(`/api/darbai/islaidos/${id}`, { method: 'DELETE' }),

  katiliukai: () => request<{ id: number; name: string; owner: string }[]>('/api/darbai/katiliukai'),
  projektoBankas: (projectId: number) => request<ProjektoBankas>(`/api/darbai/projektai/${projectId}/bankas`),
  susietiOperacija: (projectId: number, laukai: Susiejimas, memberId: number | null) =>
    request<ProjektoBankas>(`/api/darbai/projektai/${projectId}/bankas`, json('POST', { ...laukai, memberId })),
  atmestiPasiulyma: (projectId: number, transactionId: number) =>
    request<ProjektoBankas>(`/api/darbai/projektai/${projectId}/bankas/atmesti`, json('POST', { transactionId })),
  operacijosProjektas: (transactionId: number) => request<OperacijosProjektas>(`/api/darbai/bankas/${transactionId}`),
  priskirtiOperacija: (transactionId: number, laukai: Susiejimas, memberId: number | null) =>
    request<OperacijosProjektas>(`/api/darbai/bankas/${transactionId}`, json('POST', { ...laukai, memberId })),
  atsietiOperacija: (transactionId: number) => request<OperacijosProjektas>(`/api/darbai/bankas/${transactionId}`, { method: 'DELETE' }),

  pirkiniai: () => request<PirkiniuDuomenys>('/api/darbai/pirkiniai'),
  pridetiPreke: (laukai: { listId: number; name: string; quantity: string | null }, memberId: number | null) =>
    request<Preke>('/api/darbai/pirkiniai', json('POST', { ...laukai, memberId })),
  keistiPreke: (
    id: number,
    laukai: { checked?: boolean; name?: string; quantity?: string | null; section?: string },
    memberId: number | null
  ) => request<Preke>(`/api/darbai/pirkiniai/${id}`, json('PATCH', { ...laukai, memberId })),
  istrintiPreke: (id: number) => request<{ ok: true }>(`/api/darbai/pirkiniai/${id}`, { method: 'DELETE' }),
}
