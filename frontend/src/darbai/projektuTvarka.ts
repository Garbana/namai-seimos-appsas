import type { Projektas } from './api'
import { dienuSkirtumas } from './datos'

/** „liko 22 d.“, „šiandien“, „rytoj“, „praėjo 3 d.“ */
export function likoTekstas(data: string, siandiena: string): string {
  const kiek = dienuSkirtumas(siandiena, data)
  if (kiek === 0) return 'šiandien'
  if (kiek === 1) return 'rytoj'
  return kiek > 0 ? `liko ${kiek} d.` : `praėjo ${-kiek} d.`
}

/** Projekto biudžeto tikslas: nurodytas biudžetas, o jei jo nėra — eilučių planų suma. */
export const biudzetoTikslas = (p: Projektas) => p.budget_cents ?? (p.planned_cents > 0 ? p.planned_cents : null)

/** 1250 → „12,5“ (įvedimo laukui). */
export const eurai = (c: number | null) => (c === null ? '' : String(c / 100).replace('.', ','))
