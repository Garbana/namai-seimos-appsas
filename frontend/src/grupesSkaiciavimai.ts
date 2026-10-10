import type { GrupesLangelis } from './api'

/** Viena grupės ekrano eilutė: kategorija ir jos sumos pagal mėnesius (centai, su banko ženklu). */
export type GrupesEilute = {
  id: number
  name: string
  sortOrder: number
  /** Primesta iš kitos grupės (pvz. lizingas prie automobilio). */
  related: boolean
  originGroupName: string | null
  subgroup: string | null
  pagalMenesi: Map<string, number>
}

export function grupesEilutes(cells: GrupesLangelis[]) {
  const menesiai = [...new Set(cells.map((c) => c.month))].sort()
  const pagal = new Map<number, GrupesEilute>()
  for (const c of cells) {
    let eilute = pagal.get(c.categoryId)
    if (!eilute) {
      eilute = {
        id: c.categoryId,
        name: c.categoryName,
        sortOrder: c.sortOrder,
        related: c.related === 1,
        originGroupName: c.originGroupName,
        subgroup: c.subgroup,
        pagalMenesi: new Map(),
      }
      pagal.set(c.categoryId, eilute)
    }
    eilute.pagalMenesi.set(c.month, c.amount)
  }
  const eilutes = [...pagal.values()].sort((a, b) => a.sortOrder - b.sortOrder)
  return { menesiai, eilutes }
}

/**
 * Eilutės lentelei: poskyrio (pvz., „Būreliai“) kategorijos sudedamos po jo antrašte toje
 * vietoje, kur yra pirmoji jų; kitos — sava tvarka.
 */
export function suPoskyriais(eilutes: GrupesEilute[]): (GrupesEilute | { poskyris: string; eilutes: GrupesEilute[] })[] {
  const out: (GrupesEilute | { poskyris: string; eilutes: GrupesEilute[] })[] = []
  const jau = new Set<string>()
  for (const e of eilutes) {
    if (!e.subgroup) out.push(e)
    else if (!jau.has(e.subgroup)) {
      jau.add(e.subgroup)
      out.push({ poskyris: e.subgroup, eilutes: eilutes.filter((x) => x.subgroup === e.subgroup) })
    }
  }
  return out
}

/** „2026-01" ± n mėnesių. */
export function perkeltiMenesi(month: string, n: number) {
  const [y, m] = month.split('-').map(Number)
  const t = y * 12 + (m - 1) + n
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
}

/** Visi mėnesiai nuo–iki be tarpų, kad grafike tuščias mėnuo nebūtų praleistas. */
export function menesiuSeka(nuo: string, iki: string) {
  const seka: string[] = []
  for (let m = nuo; m <= iki; m = perkeltiMenesi(m, 1)) seka.push(m)
  return seka
}

/**
 * Santykinis pokytis (0,12 = +12 %). Reikšmės jau paverstos „daugiau = teigiama"
 * (išlaidoms — išleista suma). null, jei nėra su kuo lyginti.
 */
export function pokytis(dabar: number | undefined, pries: number | undefined) {
  if (dabar === undefined || pries === undefined || pries <= 0 || dabar < 0) return null
  return dabar / pries - 1
}
