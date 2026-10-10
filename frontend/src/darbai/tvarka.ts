import type { Uzduotis } from './api'

const PRIORITETO_EILE = { svarbu: 0, iprasta: 1, kada_nors: 2 }

/** Pirma — anksčiausias terminas, tada laikas, svarbumas, sukūrimo eilė. */
export const pagalTermina = (a: Uzduotis, b: Uzduotis) =>
  (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') ||
  (a.due_time ?? '99').localeCompare(b.due_time ?? '99') ||
  PRIORITETO_EILE[a.priority] - PRIORITETO_EILE[b.priority] ||
  a.id - b.id

/** 1 darbas, 2 darbai, 10 darbų, 21 darbas. */
export function darbuZodis(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return `${n} darbas`
  if (n % 10 >= 2 && (n % 100 < 10 || n % 100 > 20)) return `${n} darbai`
  return `${n} darbų`
}
